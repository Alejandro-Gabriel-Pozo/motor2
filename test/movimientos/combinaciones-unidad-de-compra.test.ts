import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/sesion/session", () => ({ getUsuarioActual: vi.fn() }));

import { baseDeTest, crearUsuarioConMembresia, EMPRESA_POR_DEFECTO_ID, limpiarBaseDeTest, prisma, sembrarBase, sembrarCatalogoBase, sembrarProductoDisponible, sembrarSeccion } from "../setup/test-db";
import { leerOraculoDeUnidadDeCompra } from "../setup/oraculo-unidad-de-compra";
import { REFERENCIA_DE_PRUEBA } from "../setup/referencia-de-prueba";
import { registrarMovimientoCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-movimiento";
import { registrarFacturaProveedorCasoDeUso } from "../../src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor";
import { mediodiaDelDia, ZONA_ARGENTINA, diaDeCalendario } from "../../src/core/tiempo/zona-horaria";
import type { DatosMovimientoInput, ItemMovimientoInput } from "../../src/core/features/movimientos/movimiento.schema";

/**
 * Compras, etapa 2a: las 32 combinaciones U (unidad de compra) × M (magnitud) × R (cantidad real) × F (forma) × T (envío) de la unidad de compra y lo comprado, contra Postgres real.
 * El ORÁCULO está escrito aparte, en `docs/oraculo-combinaciones-compras-etapa-2a-2026-11-04.md`: este test PARSEA su tabla «Enumeración» (el resultado esperado de cada fila sale del .md, no del código) y arma el
 * escenario de cada fila. El guardián de dimensiones nuevas es `test/arquitectura/combinaciones-unidad-de-compra-declaradas.test.ts`.
 *
 * Escenario por (U, M): el stock siempre se lleva en kg (2 decimales).
 *  - IGUAL_A_STOCK / IGUAL: se compra en kg (sin unidad de compra propia, factor 1): 10 kg por $1000. Cantidad real 9,5 (que el servidor tiene que rechazar).
 *  - DISTINTA_DE_STOCK / IGUAL: se compra en gramos (PESO, factor 0,001): 5000 g = 5 kg por $1000. Cantidad real 4,9 (rechazada).
 *  - DISTINTA_DE_STOCK / DISTINTA: se compra en cajas (CANTIDAD, factor 25): 3 cajas = 75 kg por $1000. Cantidad real 74,2 (aceptada: entran 74,2 kg).
 *  - IGUAL_A_STOCK / DISTINTA: imposible (la misma unidad es del mismo tipo): se verifica que el escenario de «misma unidad» no puede cruzar de tipo.
 * F = FACTURA_REPARTIDA: una factura con UNA parte del 100 % en esta sucursal (el reparto entre varias ya está probado en `factura-proveedor-repartida.test.ts`).
 */
const oraculo = leerOraculoDeUnidadDeCompra();
const mediodiaDeHoy = () => mediodiaDelDia(diaDeCalendario(new Date(), ZONA_ARGENTINA), ZONA_ARGENTINA);

let central: string;
let seccionId: string;
let adminId: string;
let proveedorId: string;
let kgId: string;
const productos: Record<string, string> = {};
const unidades: Record<string, string> = {};

const actor = () => ({ usuarioId: adminId, empresaId: EMPRESA_POR_DEFECTO_ID, sucursalId: central, sucursalNombre: "Central", ahora: new Date(), ...baseDeTest({ lectura: [central], escritura: [central] }) });

interface Escenario {
  clave: "IGUAL" | "G" | "CAJA";
  /** Lo que se tecleó. */
  cantidad: number;
  pesoReal: number;
  /** Unidad de compra esperada y cuánto entra al stock SIN cantidad real (cantidad × factor), en kg. */
  unidadDeCompra: () => string;
  stockSinPesoReal: number;
}
const ESCENARIOS: Record<string, Escenario> = {
  "IGUAL_A_STOCK|IGUAL": { clave: "IGUAL", cantidad: 10, pesoReal: 9.5, unidadDeCompra: () => kgId, stockSinPesoReal: 10 },
  "DISTINTA_DE_STOCK|IGUAL": { clave: "G", cantidad: 5000, pesoReal: 4.9, unidadDeCompra: () => unidades.g!, stockSinPesoReal: 5 },
  "DISTINTA_DE_STOCK|DISTINTA": { clave: "CAJA", cantidad: 3, pesoReal: 74.2, unidadDeCompra: () => unidades.caja!, stockSinPesoReal: 75 },
};

const conteos = async () => ({
  operacion: await prisma.operacion.count(),
  movimientoStock: await prisma.movimientoStock.count(),
  proveedorPorProducto: await prisma.proveedorPorProducto.count(),
  facturaProveedor: await prisma.facturaProveedor.count(),
  renglon: await prisma.facturaProveedorRenglon.count(),
});

beforeAll(() => {
  expect(oraculo.filas.length, "agregar un valor a una dimensión (U, M, R, F, T) cambia el tamaño del producto: actualizá este número a propósito (2 * 2 * 2 * 2 * 2 = 32)").toBe(32);
});

beforeEach(async () => {
  await limpiarBaseDeTest();
  const base = await sembrarBase();
  central = base.sucursal.id;
  seccionId = (await sembrarSeccion(central)).id;
  adminId = (await crearUsuarioConMembresia({ email: "admin@test.com", sucursalId: central, rolId: base.admin.id })).id;
  const { kg, g, insumo } = await sembrarCatalogoBase();
  kgId = kg.id;
  unidades.g = g.id;
  unidades.caja = (await prisma.unidad.create({ data: { nombre: "caja", magnitud: "CANTIDAD", decimales: 0 } })).id;
  const mp = (codigo: string, extra: { unidadCompraId?: string; factorConversion?: string }) =>
    sembrarProductoDisponible({ codigo, nombre: codigo, tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id, ...extra }, central).then((p) => p.id);
  productos.IGUAL = await mp("MP_KG", {});
  productos.G = await mp("MP_G", { unidadCompraId: g.id, factorConversion: "0.001" });
  productos.CAJA = await mp("MP_CAJA", { unidadCompraId: unidades.caja, factorConversion: "25" });
  proveedorId = (await prisma.proveedor.create({ data: { codigo: "PRV_1", nombre: "Molino SA" } })).id;
});

type Resultado = { ok: boolean; codigo?: string; mensaje?: string; datos?: { repetida?: boolean } };

describe("las 32 combinaciones del oráculo (U × M × R × F × T) contra la base real", () => {
  oraculo.filas.forEach((fila, indice) => {
    const { U, M, R, F, T, Resultado: esperado } = fila as Record<string, string>;
    it(`${indice + 1}. U=${U} M=${M} R=${R} F=${F} T=${T} → ${esperado}`, async () => {
      if (esperado === "IMPOSIBLE") {
        // La misma unidad es del mismo tipo: el escenario «misma unidad» resuelve la unidad de compra a la de stock, así que no puede cruzar de tipo.
        expect(U, "solo U = IGUAL_A_STOCK con M = DISTINTA es imposible").toBe("IGUAL_A_STOCK");
        expect(M).toBe("DISTINTA");
        expect(ESCENARIOS["IGUAL_A_STOCK|IGUAL"]!.unidadDeCompra()).toBe(kgId);
        return;
      }
      const e = ESCENARIOS[`${U}|${M}`];
      if (!e) throw new Error(`Combinación U|M desconocida: ${U}|${M}`);
      if (R !== "SIN" && R !== "CON") throw new Error(`Valor de R desconocido: ${R}`);
      if (T !== "PRIMERO" && T !== "REINTENTO") throw new Error(`Valor de T desconocido: ${T}`);

      const item: ItemMovimientoInput = { productoId: productos[e.clave]!, cantidad: e.cantidad, precioTotal: 1000, referenciaProveedor: REFERENCIA_DE_PRUEBA, ...(R === "CON" ? { pesoReal: e.pesoReal } : {}) };
      const clave = randomUUID();
      const nroFactura = `A-1-${420_000 + indice}`;
      const enviar = async (): Promise<Resultado> => {
        if (F === "COMPRA_SIMPLE") {
          const datos: DatosMovimientoInput = { proceso: "COMPRA", fecha: mediodiaDeHoy(), seccionId, proveedorId, nroFactura, items: [item], claveIdempotencia: clave };
          return registrarMovimientoCasoDeUso(actor(), datos) as Promise<Resultado>;
        }
        if (F === "FACTURA_REPARTIDA") {
          return registrarFacturaProveedorCasoDeUso(actor(), {
            fecha: mediodiaDeHoy(), proveedorId, nroFactura, seccionId, items: [item],
            reparto: { modo: "IMPORTE", partes: [{ sucursalId: central, valor: 1000 }] }, claveIdempotencia: clave,
          }) as Promise<Resultado>;
        }
        throw new Error(`Valor de F desconocido: ${F}`);
      };

      const antes = await conteos();
      const primero = await enviar();

      if (esperado === "RECHAZA") {
        expect(primero).toMatchObject({ ok: false, codigo: "LINEA_INVALIDA" });
        expect(primero.mensaje).toMatch(/cantidad real/);
        expect(await conteos(), "no se escribe NADA").toEqual(antes);
        if (T === "REINTENTO") {
          expect(await enviar(), "el reintento de un rechazo se rechaza igual").toMatchObject({ ok: false, codigo: "LINEA_INVALIDA" });
          expect(await conteos()).toEqual(antes);
        }
        return;
      }
      if (esperado !== "ACEPTA") throw new Error(`Resultado desconocido en el oráculo: ${esperado}`);

      expect(primero.ok, primero.mensaje).toBe(true);
      const despuesDelPrimero = await conteos();
      if (T === "REINTENTO") {
        const segundo = await enviar();
        expect(segundo.ok, segundo.mensaje).toBe(true);
        expect(segundo.datos?.repetida, "el reintento con la misma clave devuelve lo ya guardado").toBe(true);
        expect(await conteos(), "el reintento no escribe nada más").toEqual(despuesDelPrimero);
      }

      // El stock y el dinero NO cambian: cantidad × factor, o la cantidad real si se cargó (solo es posible cruzando de tipo).
      const stockEsperado = R === "CON" ? e.pesoReal : e.stockSinPesoReal;
      const movimientos = await prisma.movimientoStock.findMany({ where: { productoId: productos[e.clave]!, proceso: "COMPRA" } });
      expect(movimientos).toHaveLength(1);
      const mov = movimientos[0]!;
      expect(Number(mov.cantidad)).toBe(stockEsperado);
      expect(mov.precioTotal.toFixed(2)).toBe("1000.00");

      if (F === "COMPRA_SIMPLE") {
        expect(mov.unidadCompraId).toBe(e.unidadDeCompra());
        expect(mov.cantidadCompra?.toFixed(4)).toBe(e.cantidad.toFixed(4));
        expect(await prisma.facturaProveedorRenglon.count(), "una compra simple no tiene renglón").toBe(0);
      } else {
        const renglon = await prisma.facturaProveedorRenglon.findFirstOrThrow({ where: { productoId: productos[e.clave]! } });
        expect(renglon.unidadCompraId).toBe(e.unidadDeCompra());
        expect(renglon.cantidadCompra?.toFixed(4)).toBe(e.cantidad.toFixed(4));
        expect(mov.facturaProveedorRenglonId).toBe(renglon.id);
        expect(mov.unidadCompraId, "la parte queda en NULL: se lee del renglón").toBeNull();
        expect(mov.cantidadCompra).toBeNull();
      }
    }, 30_000);
  });
});

describe("dimensiones que NO cambian el resultado (cada una equivale a lo que dice el oráculo)", () => {
  it("presentación alternativa: la unidad de compra es la de la presentación elegida, con su factor", async () => {
    const pres = await prisma.presentacion.create({ data: { productoId: productos.IGUAL!, unidadCompraId: unidades.caja!, factorConversion: "20" } });
    const r = await registrarMovimientoCasoDeUso(actor(), {
      proceso: "COMPRA", fecha: mediodiaDeHoy(), seccionId, proveedorId, nroFactura: "A-1-430001",
      items: [{ productoId: productos.IGUAL!, cantidad: 2, precioTotal: 500, unidadCompraId: pres.unidadCompraId, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: randomUUID(),
    });
    expect(r.ok, r.mensaje).toBe(true);
    const mov = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: productos.IGUAL!, proceso: "COMPRA" } });
    expect(mov.unidadCompraId).toBe(unidades.caja);
    expect(mov.cantidadCompra?.toFixed(4)).toBe("2.0000");
    expect(Number(mov.cantidad)).toBe(40);
  });

  it("compra sin precio: acepta y guarda igual la unidad y lo comprado", async () => {
    const r = await registrarMovimientoCasoDeUso(actor(), {
      proceso: "COMPRA", fecha: mediodiaDeHoy(), seccionId, proveedorId, nroFactura: "A-1-430002",
      items: [{ productoId: productos.CAJA!, cantidad: 4, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: randomUUID(),
    });
    expect(r.ok, r.mensaje).toBe(true);
    const mov = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: productos.CAJA!, proceso: "COMPRA" } });
    expect(mov.cantidadCompra?.toFixed(4)).toBe("4.0000");
    expect(Number(mov.cantidad)).toBe(100);
    expect(mov.precioTotal.toFixed(2)).toBe("0.00");
  });

  it("devolución a proveedor: usa la misma conversión pero NO guarda unidad ni cantidad comprada (solo una COMPRA las escribe)", async () => {
    const compra = await registrarMovimientoCasoDeUso(actor(), {
      proceso: "COMPRA", fecha: mediodiaDeHoy(), seccionId, proveedorId, nroFactura: "A-1-430003",
      items: [{ productoId: productos.CAJA!, cantidad: 4, precioTotal: 800, referenciaProveedor: REFERENCIA_DE_PRUEBA }], claveIdempotencia: randomUUID(),
    });
    expect(compra.ok, compra.mensaje).toBe(true);
    const dev = await registrarMovimientoCasoDeUso(actor(), {
      proceso: "DEVOLUCION_PROVEEDOR", fecha: mediodiaDeHoy(), seccionId, proveedorId,
      items: [{ productoId: productos.CAJA!, cantidad: 1, precioTotal: 200 }], claveIdempotencia: randomUUID(),
    } as DatosMovimientoInput);
    expect(dev.ok, dev.mensaje).toBe(true);
    const mov = await prisma.movimientoStock.findFirstOrThrow({ where: { productoId: productos.CAJA!, proceso: "DEVOLUCION_PROVEEDOR" } });
    expect(mov.unidadCompraId).toBeNull();
    expect(mov.cantidadCompra).toBeNull();
    expect(Number(mov.cantidad)).toBe(-25);
  });
});
