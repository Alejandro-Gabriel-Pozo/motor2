import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repartirImporte } from "../../src/core/moneda";
import { aCentavos, repartirEnDosPasos } from "../setup/centros-de-costos";
import { datosDeRenglonSinStock, sembrarEscenarioDeGasto, type EscenarioDeGasto } from "../setup/gasto";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 3, M4.3 (D3 del dueño): el DINERO de la imputación de un gasto es exacto. Un renglón sin stock (importe `precioTotal` con IVA incluido y su `importeIvaComputable`) se reparte entre las sucursales en DOS pasos con
 * `repartirImporte` (mayor residuo): (1) el importe del renglón con los pesos del reparto; (2) el IVA computable con pesos = los importes de (1) EN CENTAVOS, con las sucursales ordenadas por id. Así nunca queda un computable mayor que su
 * importe (el CHECK `ImputacionDeGasto_iva_computable_chk` lo exige) y las dos sumas dan EXACTO el del renglón. Acá se escribe de verdad y las sumas se leen EN SQL, con NUMERIC, no en JavaScript.
 *
 * Propiedades (fast-check contra la base): (1) Σ de los importes = `precioTotal` del renglón y Σ de los computables = su `importeIvaComputable`; (2) cada computable ≤ su importe; (3) el resultado de cada sucursal NO depende del orden en que
 * se hayan armado las partes, con tal de ordenarlas por id; (4) con una sola sucursal el reparto es la identidad; (5) cuando el reparto deja una parte en cero centavos la BASE la rechaza (importe > 0) y no queda ninguna fila: la Etapa C lo
 * rechaza antes con un mensaje explícito.
 *
 * El reparto en dos pasos (`repartirEnDosPasos`) vive en `test/setup/centros-de-costos.ts`, compartido con la distribución entre centros de costos (M7): lo usará el caso de uso de la Etapa C (que lo extraerá a `src/core/` cuando exista quien lo llame).
 */
afterAll(() => prismaAdmin.$disconnect());

let e: EscenarioDeGasto;
let sucursales: string[]; // ordenadas por id
let contador = 100;

beforeAll(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeGasto();
  const extra = await Promise.all(["Sur", "Este"].map(async (nombre) => (await prisma.sucursal.create({ data: { nombre } })).id));
  sucursales = [e.sucursalA, e.sucursalB, ...extra].sort();
}, 60_000);

const aDecimal = (centavos: bigint): string => {
  const t = centavos.toString().padStart(3, "0");
  return `${t.slice(0, t.length - 2)}.${t.slice(t.length - 2)}`;
};
/** Un renglón sin stock de `total` (con su desglose de IVA para que el computable sea válido en el renglón) y devuelve su id. */
async function renglon(totalCentavos: bigint, computableCentavos: bigint) {
  contador += 1;
  const total = aDecimal(totalCentavos);
  const computable = aDecimal(computableCentavos);
  const r = await prisma.facturaProveedorRenglon.create({
    data: datosDeRenglonSinStock({ facturaProveedorId: e.facturaId, conceptoGastoId: e.conceptoId }, {
      orden: contador, precioTotal: total, alicuotaIva: "IVA_21", importeNeto: aDecimal(totalCentavos - computableCentavos), importeIva: computable, importeIvaComputable: computable,
    }) as never,
  });
  return { id: r.id, total, computable };
}

async function leerSumas(renglonId: string) {
  const [s] = await prismaAdmin.$queryRaw<Array<{ importes: string | null; computables: string | null; filas: bigint }>>`
    SELECT sum("importe")::text AS importes, sum("importeIvaComputable")::text AS computables, count(*) AS filas FROM "ImputacionDeGasto" WHERE "facturaProveedorRenglonId" = ${renglonId}`;
  const [r] = await prismaAdmin.$queryRaw<Array<{ total: string; computable: string }>>`SELECT "precioTotal"::text AS total, "importeIvaComputable"::text AS computable FROM "FacturaProveedorRenglon" WHERE id = ${renglonId}`;
  return { ...s!, renglon: r! };
}

describe("el reparto del gasto entre sucursales suma EXACTO y el computable nunca pasa del importe (propiedades contra la base)", () => {
  it("para cualquier total, computable y pesos: Σ importes = precioTotal del renglón, Σ computables = su IVA computable y cada computable ≤ su importe", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: BigInt(400), max: BigInt(99999999999) }), // total en centavos, con piso para que ninguna parte quede en cero con estos pesos
        fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom(1, 0.9999, 0.99, 0.5)), // qué parte del total es IVA computable (con casos pegados al límite computable = total)
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 2, maxLength: 4 }),
        async (total, fraccion, pesos) => {
          const computable = BigInt(Math.floor(Number(total) * fraccion));
          const reng = await renglon(total, computable);
          const partes = pesos.map((peso, i) => ({ id: sucursales[i]!, peso }));
          const reparto = repartirEnDosPasos(Number(reng.total), Number(reng.computable), partes);
          fc.pre(reparto.every((p) => aCentavos(p.importe) > 0)); // el caso de una parte en cero tiene su propia prueba
          for (const p of reparto) {
            expect(aCentavos(p.computable), "el computable de cada sucursal no pasa de su importe").toBeLessThanOrEqual(aCentavos(p.importe));
            await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: reng.id, sucursalId: p.id, importe: p.importe.toFixed(2), importeIvaComputable: p.computable.toFixed(2) } as never });
          }
          const s = await leerSumas(reng.id);
          expect(s.importes, "la suma en SQL de los importes es exactamente el precioTotal del renglón").toBe(s.renglon.total);
          expect(s.computables, "la suma en SQL de los computables es exactamente el IVA computable del renglón").toBe(s.renglon.computable);
        },
      ),
      { numRuns: 25 },
    );
  }, 180_000);

  it("el resultado de cada sucursal no depende del orden en que se armaron las partes (se ordenan por id antes de repartir)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 99999999 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 2, maxLength: 4 }),
        fc.infiniteStream(fc.integer()),
        (totalCentavos, fraccion, pesos, azar) => {
          const partes = pesos.map((peso, i) => ({ id: sucursales[i]!, peso }));
          const barajadas = [...partes].map((p) => ({ p, k: azar.next().value as number })).sort((a, b) => a.k - b.k).map((x) => x.p);
          const total = totalCentavos / 100;
          const computable = Math.floor(totalCentavos * fraccion) / 100;
          expect(repartirEnDosPasos(total, computable, barajadas)).toEqual(repartirEnDosPasos(total, computable, partes));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("con UNA sola sucursal el reparto es la identidad: el importe y el computable enteros", async () => {
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: BigInt(1), max: BigInt(99999999999) }), fc.double({ min: 0, max: 1, noNaN: true }), async (total, fraccion) => {
        const computable = BigInt(Math.floor(Number(total) * fraccion));
        const reng = await renglon(total, computable);
        const [unica] = repartirEnDosPasos(Number(reng.total), Number(reng.computable), [{ id: sucursales[0]!, peso: 7 }]);
        await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: reng.id, sucursalId: sucursales[0]!, importe: unica!.importe.toFixed(2), importeIvaComputable: unica!.computable.toFixed(2) } as never });
        const s = await leerSumas(reng.id);
        expect([s.importes, s.computables]).toEqual([reng.total, reng.computable]);
      }),
      { numRuns: 15 },
    );
  }, 60_000);

  it("casos de centavos que rompen un reparto ingenuo: 100,00 con 21,00 de IVA en tres partes iguales, y el IVA computable entero en una sola sucursal", async () => {
    const reng = await renglon(BigInt(10000), BigInt(2100));
    const reparto = repartirEnDosPasos(100, 21, [{ id: sucursales[0]!, peso: 1 }, { id: sucursales[1]!, peso: 1 }, { id: sucursales[2]!, peso: 1 }]);
    expect(reparto.map((p) => [p.importe.toFixed(2), p.computable.toFixed(2)])).toEqual([["33.34", "7.00"], ["33.33", "7.00"], ["33.33", "7.00"]]);
    for (const p of reparto) await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: reng.id, sucursalId: p.id, importe: p.importe.toFixed(2), importeIvaComputable: p.computable.toFixed(2) } as never });
    expect(await leerSumas(reng.id)).toMatchObject({ importes: "100.00", computables: "21.00" });
    // 0,10 de IVA entre tres sucursales de 33,33 / 33,33 / 33,34: el centavo de resto cae en una sola parte y nunca pasa de su importe.
    const chico = await renglon(BigInt(10000), BigInt(10));
    const r2 = repartirEnDosPasos(100, 0.1, [{ id: sucursales[0]!, peso: 1 }, { id: sucursales[1]!, peso: 1 }, { id: sucursales[2]!, peso: 1 }]);
    expect(r2.reduce((s, p) => s + aCentavos(p.computable), 0)).toBe(10);
    for (const p of r2) await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: chico.id, sucursalId: p.id, importe: p.importe.toFixed(2), importeIvaComputable: p.computable.toFixed(2) } as never });
    expect(await leerSumas(chico.id)).toMatchObject({ importes: "100.00", computables: "0.10" });
  });

  it("POR QUÉ DOS PASOS: repartir el computable con los MISMOS pesos que el importe puede dejar un computable mayor que su importe (0,02 contra 0,01) y la base lo rechaza; con pesos = los importes en centavos, no", async () => {
    // 0,20 de importe y 0,19 de IVA computable entre tres sucursales con pesos 1, 3 y 9.
    const pesos = [1, 3, 9];
    const importes = repartirImporte(0.2, pesos).map(aCentavos);
    const ingenuo = repartirImporte(0.19, pesos).map(aCentavos);
    expect(importes).toEqual([1, 5, 14]);
    expect(ingenuo).toEqual([2, 4, 13]);
    expect(ingenuo.some((c, i) => c > importes[i]!), "el reparto ingenuo se pasa en la primera sucursal").toBe(true);
    const reng = await renglon(BigInt(20), BigInt(19));
    await expect(
      prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: reng.id, sucursalId: sucursales[0]!, importe: "0.01", importeIvaComputable: "0.02" } as never }),
    ).rejects.toThrow(/ImputacionDeGasto_iva_computable_chk/);
    const bueno = repartirEnDosPasos(0.2, 0.19, pesos.map((peso, i) => ({ id: sucursales[i]!, peso })));
    expect(bueno.map((p) => aCentavos(p.computable))).toEqual([1, 5, 13]);
    for (const p of bueno) await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: reng.id, sucursalId: p.id, importe: p.importe.toFixed(2), importeIvaComputable: p.computable.toFixed(2) } as never });
    expect(await leerSumas(reng.id)).toMatchObject({ importes: "0.20", computables: "0.19" });
  });

  it("el computable entero va a la sucursal que lo paga cuando solo ella tiene peso: nunca se pasa de su importe (cota C ≤ T en el límite)", async () => {
    const reng = await renglon(BigInt(10000), BigInt(10000)); // todo el importe es IVA (caso límite del CHECK: computable = importe)
    const reparto = repartirEnDosPasos(100, 100, [{ id: sucursales[0]!, peso: 3 }, { id: sucursales[1]!, peso: 2 }]);
    for (const p of reparto) expect(aCentavos(p.computable)).toBe(aCentavos(p.importe));
    for (const p of reparto) await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: reng.id, sucursalId: p.id, importe: p.importe.toFixed(2), importeIvaComputable: p.computable.toFixed(2) } as never });
    expect(await leerSumas(reng.id)).toMatchObject({ importes: "100.00", computables: "100.00" });
  });

  it("cuando el reparto deja una parte en CERO centavos, la base la rechaza (importe > 0) y la carga atómica no deja nada: el caso de uso lo rechaza antes", async () => {
    const reng = await renglon(BigInt(1), BigInt(0)); // 0,01 entre tres sucursales
    const reparto = repartirEnDosPasos(0.01, 0, [{ id: sucursales[0]!, peso: 1 }, { id: sucursales[1]!, peso: 1 }, { id: sucursales[2]!, peso: 1 }]);
    expect(reparto.map((p) => aCentavos(p.importe)).sort()).toEqual([0, 0, 1]);
    await expect(
      prisma.$transaction(async (tx) => {
        for (const p of reparto) await tx.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: reng.id, sucursalId: p.id, importe: p.importe.toFixed(2), importeIvaComputable: p.computable.toFixed(2) } as never });
      }),
    ).rejects.toThrow(/ImputacionDeGasto_importe_positivo_chk/);
    expect((await leerSumas(reng.id)).filas).toBe(BigInt(0));
  });
});
