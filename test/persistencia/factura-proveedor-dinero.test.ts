import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repartirImporte } from "../../src/core/moneda";
import { limpiarBaseDeTest, prisma, prismaAdmin, sembrarSeccion } from "../setup/test-db";
import { datosDeFactura, datosDeRenglon, sembrarEscenarioDeFactura, type EscenarioDeFactura } from "../setup/factura-proveedor";

/**
 * Paquete 3, M3b: el DINERO de la factura repartida es exacto. Una factura se carga entera (un total y renglones) y se reparte entre sucursales: cada parte es una `Operacion` COMPRA con su línea del Kardex, que
 * guarda su parte del importe del renglón. Con `repartirImporte` (mayor residuo) la suma de las partes da SIEMPRE, exacto, el importe del renglón: nunca un centavo de más ni de menos. Acá se escribe de verdad (la
 * cabecera, el renglón, las partes, las operaciones y las líneas del Kardex con `facturaProveedorRenglonId`) y se lee la suma EN SQL, con NUMERIC, no en JavaScript.
 *
 * Propiedades (fast-check, 20 corridas contra la base): (1) la suma en SQL de `precioTotal` de las líneas del renglón es exactamente el `precioTotal` del renglón; (2) el `precioPorUnidadStock` leído de vuelta es
 * IDÉNTICO en todas las partes (se calcula una vez y se copia); (3) los porcentajes declarados suman 10000; (4) con una sola parte el reparto es la identidad. Más los casos de centavos que rompen un reparto ingenuo.
 *
 * Los porcentajes declarados NUNCA se usan para atribuir dinero: aquí los pesos del reparto son los de quien carga, pero lo que queda como verdad es el dinero de cada línea (`precioTotal`).
 */
afterAll(() => prismaAdmin.$disconnect());

let e: EscenarioDeFactura;
let sucursales: Array<{ id: string; seccionId: string }>;

beforeAll(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeFactura();
  const extra = await Promise.all(["Sur", "Este"].map(async (nombre) => {
    const s = await prisma.sucursal.create({ data: { nombre } });
    return { id: s.id, seccionId: (await sembrarSeccion(s.id, "Depósito")).id };
  }));
  sucursales = [{ id: e.sucursalA, seccionId: e.seccionA }, { id: e.sucursalB, seccionId: e.seccionB }, ...extra];
}, 60_000);

/** Puntos básicos que suman EXACTO 10000 a partir de pesos enteros positivos (mayor residuo, sobre 100 pesos para reutilizar `repartirImporte`). */
const basicPoints = (pesos: number[]): number[] => repartirImporte(100, pesos).map((p) => Math.round(p * 100));

/** Precio por unidad de stock con 4 decimales, en enteros: round_half_up(centavos × 10^6 / cantidad×10^4). Sin float. */
function precioPorUnidad4(centavos: bigint, cantidad4: bigint): bigint {
  const numerador = centavos * BigInt(1000000) * BigInt(2) + cantidad4;
  return numerador / (cantidad4 * BigInt(2));
}
/** El precio por unidad es NUMERIC(14,4): hasta 9.999.999.999,9999. Un total enorme sobre una cantidad minúscula lo desborda (la base lo rechaza); no es un reparto, así que la propiedad lo descarta. */
const cabeEnLaColumna = (centavos: bigint, cantidad4: bigint): boolean => precioPorUnidad4(centavos, cantidad4) < BigInt("100000000000000");
const aDecimal = (entero: bigint, decimales: number): string => {
  const texto = entero.toString().padStart(decimales + 1, "0");
  return `${texto.slice(0, texto.length - decimales)}.${texto.slice(texto.length - decimales)}`;
};

interface Resultado {
  suma: string;
  renglonTotal: string;
  precios: string[];
  precioRenglon: string;
  basicPointsSuman: number;
  partes: string[];
}

/** Escribe una factura de UN renglón repartida entre `pesos.length` sucursales, y devuelve lo que la base guardó. */
async function escribirRepartida(centavos: bigint, cantidad4: bigint, pesos: number[]): Promise<Resultado> {
  const total = aDecimal(centavos, 2);
  const precioUnidad = aDecimal(precioPorUnidad4(centavos, cantidad4), 4);
  const bp = basicPoints(pesos);
  const importes = repartirImporte(Number(total), bp);
  const cabecera = await prisma.facturaProveedor.create({ data: datosDeFactura(e, { importeTotal: total }) as never });
  const renglon = await prisma.facturaProveedorRenglon.create({
    data: datosDeRenglon({ facturaProveedorId: cabecera.id, productoId: e.productoId }, { cantidadStock: aDecimal(cantidad4, 4), precioPorUnidadStock: precioUnidad, precioTotal: total }) as never,
  });
  for (let i = 0; i < bp.length; i++) {
    const sucursal = sucursales[i]!;
    const operacion = await prisma.operacion.create({ data: { sucursalId: sucursal.id, fecha: new Date("2026-10-13T15:00:00Z"), usuarioId: e.usuarioId, proceso: "COMPRA" } });
    await prisma.facturaProveedorSucursal.create({ data: { facturaProveedorId: cabecera.id, sucursalId: sucursal.id, porcentajeDeclaradoBp: bp[i]!, operacionId: operacion.id } });
    await prisma.movimientoStock.create({
      data: {
        operacionId: operacion.id, productoId: e.productoId, seccionId: sucursal.seccionId, proceso: "COMPRA", cantidad: aDecimal(((cantidad4 * BigInt(bp[i]!)) / BigInt(10000)) || BigInt(1), 4), detalle: "reparto",
        precioTotal: importes[i]!.toFixed(2), precioPorUnidadStock: precioUnidad, facturaProveedorRenglonId: renglon.id,
      },
    });
  }
  const suma = await prismaAdmin.$queryRaw<Array<{ suma: string }>>`SELECT sum("precioTotal")::text AS suma FROM "MovimientoStock" WHERE "facturaProveedorRenglonId" = ${renglon.id}`;
  const precios = await prismaAdmin.$queryRaw<Array<{ p: string }>>`SELECT DISTINCT "precioPorUnidadStock"::text AS p FROM "MovimientoStock" WHERE "facturaProveedorRenglonId" = ${renglon.id}`;
  const guardado = await prismaAdmin.$queryRaw<Array<{ total: string; precio: string }>>`SELECT "precioTotal"::text AS total, "precioPorUnidadStock"::text AS precio FROM "FacturaProveedorRenglon" WHERE id = ${renglon.id}`;
  const sumaBp = await prismaAdmin.$queryRaw<Array<{ s: bigint }>>`SELECT sum("porcentajeDeclaradoBp")::bigint AS s FROM "FacturaProveedorSucursal" WHERE "facturaProveedorId" = ${cabecera.id}`;
  const partes = await prismaAdmin.$queryRaw<Array<{ t: string }>>`SELECT "precioTotal"::text AS t FROM "MovimientoStock" WHERE "facturaProveedorRenglonId" = ${renglon.id} ORDER BY "creadoEn", id`;
  return { suma: suma[0]!.suma, renglonTotal: guardado[0]!.total, precios: precios.map((p) => p.p), precioRenglon: guardado[0]!.precio, basicPointsSuman: Number(sumaBp[0]!.s), partes: partes.map((p) => p.t) };
}

describe("el reparto de una factura entre sucursales suma EXACTO (propiedades contra la base)", () => {
  it("para cualquier total en centavos, cantidad y pesos: Σ importes de las líneas = importe del renglón, mismo precio por unidad en todas las partes, Σ puntos básicos = 10000", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: BigInt(0), max: BigInt(99999999999) }), // hasta 999.999.999,99 (cabe en NUMERIC(14,2))
        fc.bigInt({ min: BigInt(1), max: BigInt(9999999) }), // cantidad con 4 decimales: de 0,0001 a 999,9999
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 2, maxLength: 4 }),
        async (centavos, cantidad4, pesos) => {
          fc.pre(cabeEnLaColumna(centavos, cantidad4));
          const r = await escribirRepartida(centavos, cantidad4, pesos);
          expect(r.suma, "la suma en SQL de las partes es exactamente el importe del renglón").toBe(r.renglonTotal);
          expect(r.precios, "el precio por unidad es idéntico en todas las partes").toEqual([r.precioRenglon]);
          expect(r.basicPointsSuman, "los porcentajes declarados suman 10000").toBe(10000);
        },
      ),
      { numRuns: 20 },
    );
  }, 120_000);

  it("con UNA sola parte el reparto es la identidad: el importe del renglón entero", async () => {
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: BigInt(0), max: BigInt(99999999999) }), fc.bigInt({ min: BigInt(1), max: BigInt(9999999) }), async (centavos, cantidad4) => {
        fc.pre(cabeEnLaColumna(centavos, cantidad4));
        const r = await escribirRepartida(centavos, cantidad4, [1]);
        expect(r.partes).toEqual([r.renglonTotal]);
      }),
      { numRuns: 8 },
    );
  }, 60_000);

  it("casos de centavos que rompen un reparto ingenuo: 100,00 en tres partes iguales, 0,01 en tres, 0,02 en tres y un total de una sola unidad", async () => {
    const tres = await escribirRepartida(BigInt(10000), BigInt(30000), [1, 1, 1]);
    expect(tres.partes.slice().sort()).toEqual(["33.33", "33.33", "33.34"]);
    expect(tres.suma).toBe("100.00");
    const uncentavo = await escribirRepartida(BigInt(1), BigInt(10000), [1, 1, 1]);
    expect(uncentavo.partes.slice().sort()).toEqual(["0.00", "0.00", "0.01"]);
    expect(uncentavo.suma).toBe("0.01");
    const dos = await escribirRepartida(BigInt(2), BigInt(10000), [1, 1, 1]);
    expect(dos.suma).toBe("0.02");
    const desparejo = await escribirRepartida(BigInt(100000), BigInt(7777), [3, 3, 1, 1]);
    expect(desparejo.suma).toBe("1000.00");
    expect(desparejo.precios).toEqual([desparejo.precioRenglon]);
  });

  it("el precio por unidad se calcula UNA vez: 100,00 por 3 unidades da 33,3333 en las tres partes aunque las partes no sumen 100,00 a ese precio", async () => {
    const r = await escribirRepartida(BigInt(10000), BigInt(30000), [1, 1, 1]);
    expect(r.precioRenglon).toBe("33.3333");
    expect(r.precios).toEqual(["33.3333"]);
  });

  it("un importe que no entra en NUMERIC(14,2) se rechaza en vez de redondearse en silencio", async () => {
    const f = await prisma.facturaProveedor.create({ data: datosDeFactura(e) as never });
    await expect(prisma.facturaProveedorRenglon.create({ data: datosDeRenglon({ facturaProveedorId: f.id, productoId: e.productoId }, { precioTotal: "1000000000000.00" }) as never })).rejects.toThrow(/out of range|numeric field overflow|too large/i);
  });
});
