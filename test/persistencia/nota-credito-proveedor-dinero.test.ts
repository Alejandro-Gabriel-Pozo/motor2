import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importeDeLinea, repartirImporte } from "../../src/core/moneda";
import { datosDeImputacion, datosDeLinea, datosDeNota, sembrarDevolucion, sembrarEscenarioDeNota, type EscenarioDeNota } from "../setup/nota-credito";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 4, M6 (dinero): el dinero de la nota de crédito de proveedor es exacto. Una línea (importe con IVA incluido y su IVA computable) se reparte entre las sucursales en DOS pasos con `repartirImporte` (mayor residuo), igual que el gasto
 * (`imputacion-de-gasto-dinero`): (1) el importe de la línea con los pesos del reparto; (2) el IVA computable con pesos = los importes de (1) EN CENTAVOS, con las sucursales ordenadas por id. Así nunca queda un computable mayor que su importe
 * (el CHECK `NotaCreditoProveedorImputacion_iva_computable_chk` lo exige) y las dos sumas dan EXACTO las de la línea. Acá se escribe de verdad y las sumas se leen EN SQL, con NUMERIC, no en JavaScript.
 *
 * Propiedades (fast-check contra la base): (1) Σ de los importes de las imputaciones = el importe de la línea y Σ de los computables = el de la línea; (2) cada computable ≤ su importe; (3) el resultado no depende del orden en que se hayan
 * armado las partes, con tal de ordenarlas por id; (4) una bonificación global repartida entre los renglones (con el `precioTotal` de cada uno como peso) suma EXACTO lo bonificado y ninguna parte pasa del renglón que acredita; (5) las devoluciones
 * parciales de una misma parte nunca suman más que ella y, la que la completa, toma el resto exacto (devuelta entera, da exacto); (6) un reparto que deja una parte en cero centavos lo rechaza la base (importe > 0) y no deja nada.
 *
 * El reparto en dos pasos, el de la bonificación y el de la devolución parcial viven acá, en el test: los usará el caso de uso de la Etapa C (que los extraerá a `src/core/` cuando exista quien los llame).
 */
afterAll(() => prismaAdmin.$disconnect());

let e: EscenarioDeNota;
let sucursales: string[]; // ordenadas por id

beforeAll(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeNota();
  const extra = await Promise.all(["Sur", "Este"].map(async (nombre) => (await prisma.sucursal.create({ data: { nombre } })).id));
  sucursales = [e.sucursalA, e.sucursalB, ...extra].sort();
}, 60_000);

const aDecimal = (centavos: bigint): string => {
  const t = centavos.toString().padStart(3, "0");
  return `${t.slice(0, t.length - 2)}.${t.slice(t.length - 2)}`;
};
const aCentavos = (importe: number) => Math.round(importe * 100);

/** El reparto en dos pasos. `pesos[i]` es el peso de `ids[i]`; las partes se ordenan por id ANTES de repartir (los empates de mayor residuo se resuelven por índice). */
function repartirEnDosPasos(importe: number, computable: number, partes: ReadonlyArray<{ id: string; peso: number }>) {
  const ordenadas = [...partes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const importes = repartirImporte(importe, ordenadas.map((p) => p.peso));
  const computables = repartirImporte(computable, importes.map(aCentavos));
  return ordenadas.map((p, i) => ({ id: p.id, importe: importes[i]!, computable: computables[i]! }));
}

/** Una nota con UNA línea de mercadería de `totalCentavos` (con su desglose de IVA para que el computable sea válido en la línea) y devuelve el id de la línea. */
async function lineaDe(totalCentavos: bigint, computableCentavos: bigint) {
  const n = await prisma.notaCreditoProveedor.create({ data: datosDeNota(e) as never });
  const total = aDecimal(totalCentavos);
  const computable = aDecimal(computableCentavos);
  const l = await prisma.notaCreditoProveedorLinea.create({
    data: datosDeLinea(e, n.id, { importe: total, alicuotaIva: "IVA_21", importeNeto: aDecimal(totalCentavos - computableCentavos), importeIva: computable, importeIvaComputable: computable }) as never,
  });
  return { notaId: n.id, id: l.id, total, computable };
}

async function leerSumas(lineaId: string) {
  const [s] = await prismaAdmin.$queryRaw<Array<{ importes: string | null; computables: string | null; filas: bigint }>>`
    SELECT sum("importe")::text AS importes, sum("importeIvaComputable")::text AS computables, count(*) AS filas FROM "NotaCreditoProveedorImputacion" WHERE "notaCreditoProveedorLineaId" = ${lineaId}`;
  const [l] = await prismaAdmin.$queryRaw<Array<{ total: string; computable: string }>>`SELECT "importe"::text AS total, "importeIvaComputable"::text AS computable FROM "NotaCreditoProveedorLinea" WHERE id = ${lineaId}`;
  return { ...s!, linea: l! };
}

const imputar = (lineaId: string, sucursalId: string, p: { importe: number; computable: number }) =>
  prisma.notaCreditoProveedorImputacion.create({ data: datosDeImputacion(e, lineaId, { sucursalId, importe: p.importe.toFixed(2), importeIvaComputable: p.computable.toFixed(2) }) as never });

describe("el reparto de una línea de la nota entre sucursales suma EXACTO y el computable nunca pasa del importe (propiedades contra la base)", () => {
  it("para cualquier total, computable y pesos: Σ importes = importe de la línea, Σ computables = su IVA computable y cada computable ≤ su importe", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: BigInt(400), max: BigInt(99999999999) }), // total en centavos, con piso para que ninguna parte quede en cero con estos pesos
        fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom(1, 0.9999, 0.99, 0.5)), // qué parte del total es IVA computable (con casos pegados al límite computable = total)
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 2, maxLength: 4 }),
        async (total, fraccion, pesos) => {
          const computable = BigInt(Math.floor(Number(total) * fraccion));
          const l = await lineaDe(total, computable);
          const reparto = repartirEnDosPasos(Number(l.total), Number(l.computable), pesos.map((peso, i) => ({ id: sucursales[i]!, peso })));
          fc.pre(reparto.every((p) => aCentavos(p.importe) > 0)); // el caso de una parte en cero tiene su propia prueba
          for (const p of reparto) {
            expect(aCentavos(p.computable), "el computable de cada sucursal no pasa de su importe").toBeLessThanOrEqual(aCentavos(p.importe));
            await imputar(l.id, p.id, p);
          }
          const s = await leerSumas(l.id);
          expect(s.importes, "la suma en SQL de los importes es exactamente el importe de la línea").toBe(s.linea.total);
          expect(s.computables, "la suma en SQL de los computables es exactamente el IVA computable de la línea").toBe(s.linea.computable);
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

  it("casos de centavos que rompen un reparto ingenuo: 100,00 con 21,00 de IVA en tres partes iguales, y por qué el computable se reparte con los importes (0,20 con 0,19 en pesos 1, 3 y 9)", async () => {
    const l = await lineaDe(BigInt(10000), BigInt(2100));
    const reparto = repartirEnDosPasos(100, 21, [{ id: sucursales[0]!, peso: 1 }, { id: sucursales[1]!, peso: 1 }, { id: sucursales[2]!, peso: 1 }]);
    expect(reparto.map((p) => [p.importe.toFixed(2), p.computable.toFixed(2)])).toEqual([["33.34", "7.00"], ["33.33", "7.00"], ["33.33", "7.00"]]);
    for (const p of reparto) await imputar(l.id, p.id, p);
    expect(await leerSumas(l.id)).toMatchObject({ importes: "100.00", computables: "21.00" });

    const pesos = [1, 3, 9];
    const importes = repartirImporte(0.2, pesos).map(aCentavos);
    const ingenuo = repartirImporte(0.19, pesos).map(aCentavos);
    expect(importes).toEqual([1, 5, 14]);
    expect(ingenuo.some((c, i) => c > importes[i]!), "repartir el computable con los MISMOS pesos se pasa del importe en la primera sucursal").toBe(true);
    const chica = await lineaDe(BigInt(20), BigInt(19));
    await expect(imputar(chica.id, sucursales[0]!, { importe: 0.01, computable: 0.02 })).rejects.toThrow(/NotaCreditoProveedorImputacion_iva_computable_chk/);
    const bueno = repartirEnDosPasos(0.2, 0.19, pesos.map((peso, i) => ({ id: sucursales[i]!, peso })));
    expect(bueno.map((p) => aCentavos(p.computable))).toEqual([1, 5, 13]);
    for (const p of bueno) await imputar(chica.id, p.id, p);
    expect(await leerSumas(chica.id)).toMatchObject({ importes: "0.20", computables: "0.19" });
  });

  it("con UNA sola sucursal el reparto es la identidad, y con todo el importe siendo IVA (computable = importe) cada parte cierra en el límite del CHECK", async () => {
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: BigInt(1), max: BigInt(99999999999) }), fc.double({ min: 0, max: 1, noNaN: true }), async (total, fraccion) => {
        const l = await lineaDe(total, BigInt(Math.floor(Number(total) * fraccion)));
        const [unica] = repartirEnDosPasos(Number(l.total), Number(l.computable), [{ id: sucursales[0]!, peso: 7 }]);
        await imputar(l.id, sucursales[0]!, unica!);
        const s = await leerSumas(l.id);
        expect([s.importes, s.computables]).toEqual([l.total, l.computable]);
      }),
      { numRuns: 15 },
    );
    const todoIva = await lineaDe(BigInt(10000), BigInt(10000));
    const reparto = repartirEnDosPasos(100, 100, [{ id: sucursales[0]!, peso: 3 }, { id: sucursales[1]!, peso: 2 }]);
    for (const p of reparto) expect(aCentavos(p.computable)).toBe(aCentavos(p.importe));
    for (const p of reparto) await imputar(todoIva.id, p.id, p);
    expect(await leerSumas(todoIva.id)).toMatchObject({ importes: "100.00", computables: "100.00" });
  }, 60_000);
});

describe("la bonificación global repartida entre los renglones suma EXACTO lo bonificado y ninguna parte pasa de su renglón", () => {
  /** La bonificación de `bonificacion` centavos entre renglones de `precios` centavos, con el precio de cada uno como peso. */
  const repartirBonificacion = (bonificacion: number, precios: readonly number[]) => repartirImporte(bonificacion / 100, precios).map(aCentavos);

  it("para cualquier bonificación (hasta lo que suman los renglones) y precios: Σ de las líneas = lo bonificado (en SQL) y cada línea ≤ su renglón", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 100, max: 5_000_000 }), { minLength: 2, maxLength: 4 }), // precioTotal de cada renglón, en centavos
        fc.double({ min: 0.0001, max: 1, noNaN: true }), // qué parte de la suma de los renglones se bonifica
        async (precios, fraccion) => {
          const suma = precios.reduce((a, b) => a + b, 0);
          const bonificacion = Math.max(precios.length, Math.floor(suma * fraccion));
          const partes = repartirBonificacion(bonificacion, precios);
          fc.pre(partes.every((c) => c > 0));
          expect(partes.reduce((a, b) => a + b, 0), "las partes suman exacto lo bonificado").toBe(bonificacion);
          const factura = await prisma.facturaProveedor.create({
            data: { proveedorId: e.proveedorId, fecha: new Date("2026-09-01T15:00:00.000Z"), importeTotal: aDecimal(BigInt(suma)), estado: "CONFIRMADA", confirmadaEn: new Date("2026-09-01T15:00:00.000Z"), confirmadaPorId: e.usuarioId, creadoPorId: e.usuarioId },
          });
          const nota = await prisma.notaCreditoProveedor.create({ data: datosDeNota({ ...e, facturaId: factura.id }, { importeTotal: aDecimal(BigInt(bonificacion)) }) as never });
          for (const [i, precio] of precios.entries()) {
            const renglon = await prisma.facturaProveedorRenglon.create({
              data: { facturaProveedorId: factura.id, orden: i + 1, naturaleza: "MERCADERIA", productoId: e.productoId, cantidadStock: "1", precioPorUnidadStock: aDecimal(BigInt(precio)), detalle: "1 kg", precioTotal: aDecimal(BigInt(precio)) },
            });
            await prisma.notaCreditoProveedorLinea.create({
              data: datosDeLinea({ facturaId: factura.id, renglonMercaderiaId: renglon.id }, nota.id, { orden: i + 1, origenImporte: "REPARTO_DEL_TOTAL", importe: aDecimal(BigInt(partes[i]!)) }) as never,
            });
          }
          const [s] = await prismaAdmin.$queryRaw<Array<{ lineas: string; total: string; fuera: bigint }>>`
            SELECT sum(l."importe")::text AS lineas, n."importeTotal"::text AS total, count(*) FILTER (WHERE l."importe" > r."precioTotal") AS fuera
            FROM "NotaCreditoProveedorLinea" l JOIN "FacturaProveedorRenglon" r ON r."id" = l."facturaProveedorRenglonId" JOIN "NotaCreditoProveedor" n ON n."id" = l."notaCreditoProveedorId"
            WHERE l."notaCreditoProveedorId" = ${nota.id} GROUP BY n."importeTotal"`;
          expect(s!.lineas, "la suma en SQL de las líneas es exactamente lo bonificado").toBe(s!.total);
          expect(Number(s!.fuera), "ninguna línea pasa del precioTotal de su renglón").toBe(0);
        },
      ),
      { numRuns: 15 },
    );
  }, 180_000);

  it("el caso que rompe un reparto ingenuo: 10,00 de bonificación entre renglones de 33,33 / 33,33 / 33,34 suma 10,00 y respeta cada renglón", () => {
    const partes = repartirBonificacion(1000, [3333, 3333, 3334]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(partes.every((c, i) => c <= [3333, 3333, 3334][i]!)).toBe(true);
  });
});

describe("las devoluciones parciales de una parte nunca suman más que ella y la que la completa toma el resto exacto", () => {
  /**
   * El importe que acredita una devolución de `cantidad` kg, con el precio por unidad de stock del renglón (4 decimales), sobre una parte de `importeParte` centavos de la que ya se acreditaron `yaAcreditado`. La parcial usa
   * `importeDeLinea` (alejándose del cero en los empates) sin pasar de lo que queda; la que COMPLETA la parte (`completa`) toma el resto exacto, para que devuelta entera dé exacto.
   */
  function importeDeDevolucion(cantidad: number, precioPorUnidad: number, importeParte: number, yaAcreditado: number, completa: boolean): number {
    const resto = importeParte - yaAcreditado;
    return completa ? resto : Math.min(aCentavos(importeDeLinea(cantidad, precioPorUnidad)), resto);
  }

  it("para cualquier parte, cantidad y forma de devolverla: Σ ≤ la parte siempre, y si se devuelve entera (la última completa) Σ = la parte", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99_999_999 }), // importe de la parte, en centavos
        fc.integer({ min: 2, max: 200 }), // cantidad comprada en la sucursal (unidades de stock)
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 8 }), // forma de partir lo devuelto (pesos)
        (importeParte, cantidadComprada, pesos) => {
          const precioPorUnidad = Math.round((importeParte / 100 / cantidadComprada) * 10000) / 10000; // el precio por unidad se guarda con 4 decimales
          // Se reparte la cantidad comprada en tantos pedazos como pesos; la última devolución completa la parte.
          const sumaPesos = pesos.reduce((a, b) => a + b, 0);
          let devuelta = 0;
          let acreditado = 0;
          for (const [i, peso] of pesos.entries()) {
            const esLaUltima = i === pesos.length - 1;
            const cantidad = esLaUltima ? cantidadComprada - devuelta : Math.floor((cantidadComprada * peso) / sumaPesos);
            if (cantidad <= 0) continue;
            const importe = importeDeDevolucion(cantidad, precioPorUnidad, importeParte, acreditado, esLaUltima);
            expect(importe, "una devolución nunca acredita un importe negativo").toBeGreaterThanOrEqual(0);
            acreditado += importe;
            devuelta += cantidad;
            expect(acreditado, "lo acreditado nunca supera la parte").toBeLessThanOrEqual(importeParte);
          }
          expect(devuelta).toBe(cantidadComprada);
          expect(acreditado, "devuelta entera, la parte da exacto").toBe(importeParte);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("contra la base: una parte de 50,00 (5 kg) devuelta en tres notas (2 kg, 2 kg y el resto) suma 50,00 EXACTO en SQL, 5 kg en total y cada devolución se acredita una sola vez", async () => {
    const parcial = (cantidad: number, acreditado: number, completa: boolean) => importeDeDevolucion(cantidad, 10, 5000, acreditado, completa);
    const importes = [parcial(2, 0, false), parcial(2, 2000, false), parcial(1, 4000, true)];
    expect(importes).toEqual([2000, 2000, 1000]);
    const cantidades = [2, 2, 1];
    const lado = ["A", "A", "A"] as const;
    for (const [i, centavos] of importes.entries()) {
      const devolucion = await sembrarDevolucion(e, lado[i]!, cantidades[i]!);
      const l = await lineaDe(BigInt(centavos), BigInt(0));
      await prisma.notaCreditoProveedorImputacion.create({
        data: datosDeImputacion(e, l.id, { importe: aDecimal(BigInt(centavos)), operacionDevolucionId: devolucion.operacionId, cantidadStock: String(cantidades[i]) }) as never,
      });
    }
    const [s] = await prismaAdmin.$queryRaw<Array<{ importes: string; cantidades: string; devoluciones: bigint }>>`
      SELECT sum(i."importe")::text AS importes, sum(i."cantidadStock")::text AS cantidades, count(DISTINCT i."operacionDevolucionId") AS devoluciones
      FROM "NotaCreditoProveedorImputacion" i WHERE i."operacionDevolucionId" IS NOT NULL`;
    expect([s!.importes, s!.cantidades, Number(s!.devoluciones)]).toEqual(["50.00", "5.0000", 3]);
  });
});

describe("cuando el reparto deja una parte en CERO centavos, la base la rechaza (importe > 0) y la carga atómica no deja nada", () => {
  it("0,01 entre tres sucursales: una parte da 0,01 y las otras dos 0,00; la transacción entera (nota, línea e imputaciones) se revierte", async () => {
    const reparto = repartirEnDosPasos(0.01, 0, [{ id: sucursales[0]!, peso: 1 }, { id: sucursales[1]!, peso: 1 }, { id: sucursales[2]!, peso: 1 }]);
    expect(reparto.map((p) => aCentavos(p.importe)).sort()).toEqual([0, 0, 1]);
    const notasAntes = await prismaAdmin.notaCreditoProveedor.count();
    const lineasAntes = await prismaAdmin.notaCreditoProveedorLinea.count();
    const imputacionesAntes = await prismaAdmin.notaCreditoProveedorImputacion.count();
    await expect(
      prisma.$transaction(async (tx) => {
        const n = await tx.notaCreditoProveedor.create({ data: datosDeNota(e, { importeTotal: "0.01" }) as never });
        const l = await tx.notaCreditoProveedorLinea.create({ data: datosDeLinea(e, n.id, { importe: "0.01" }) as never });
        for (const p of reparto) await tx.notaCreditoProveedorImputacion.create({ data: datosDeImputacion(e, l.id, { sucursalId: p.id, importe: p.importe.toFixed(2), importeIvaComputable: p.computable.toFixed(2) }) as never });
      }),
    ).rejects.toThrow(/NotaCreditoProveedorImputacion_importe_positivo_chk/);
    expect([await prismaAdmin.notaCreditoProveedor.count(), await prismaAdmin.notaCreditoProveedorLinea.count(), await prismaAdmin.notaCreditoProveedorImputacion.count()]).toEqual([notasAntes, lineasAntes, imputacionesAntes]);
  });
});
