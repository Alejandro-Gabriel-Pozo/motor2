import fc from "fast-check";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aCentavos, CONSULTAS_DE_COHERENCIA, repartirEnDosPasos, sembrarDistribucion, sembrarEscenarioDeCentros, sentenciasDeDistribucion, type EscenarioDeCentros } from "../setup/centros-de-costos";
import { cerrarConexiones, conexionComoApp, datosDeRenglonSinStock } from "../setup/gasto";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 5, M7 (Decisión 1 del dueño): el DINERO de la distribución de un gasto entre centros de costos es exacto. La imputación de una sucursal (importe con IVA incluido e `importeIvaComputable`) se reparte entre los centros de un plan en DOS
 * pasos con `repartirImporte` (mayor residuo): (1) el importe con los pesos = los puntos básicos de cada centro; (2) el IVA computable con pesos = los importes de (1) en centavos, con los centros ordenados por id. Así ningún computable pasa de su
 * importe (el CHECK lo exige) y las dos sumas dan EXACTO. Acá se escribe de verdad, como `motor2_app` con el alcance de la sucursal, y las sumas se leen EN SQL, con NUMERIC, no en JavaScript.
 *
 * Lo que la base NO impide (no hay disparadores): que los puntos básicos de una versión sumen otra cosa que 10000, que la suma de los importes no sea la de la imputación, o que el plan no aplique en la sucursal. Está demostrado acá que esas
 * versiones ENTRAN, y que las consultas de coherencia (`CONSULTAS_DE_COHERENCIA`, las mismas del chequeo posterior de `docs/deploy-con-migraciones.md`) las encuentran: esa guarda vive en el caso de uso de la Etapa C y en ese chequeo.
 *
 * Propiedades (fast-check contra la base): (1) Σ de los importes = importe de la imputación y Σ de los computables = su IVA computable; (2) cada computable ≤ su importe; (3) las consultas de coherencia dan CERO; (4) el resultado de cada centro
 * no depende del orden en que se armaron las partes, con tal de ordenarlas por id.
 */
afterAll(() => prismaAdmin.$disconnect());
afterEach(cerrarConexiones);

let e: EscenarioDeCentros;
/** Los cinco centros del plan, ordenados por id. */
let centros: string[];
let contador = 100;
let app: Client;

beforeAll(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeCentros();
  const extra = await Promise.all(["TRES", "CUATRO", "CINCO"].map(async (n) => (await prisma.centroDeCostos.create({ data: { planDeCostosId: e.planId, codigo: `UN_${n}`, nombre: `Unidad ${n}` } })).id));
  centros = [e.centroUnAId, e.centroUnBId, ...extra].sort();
  // Se parte de cero imputaciones propias: la del escenario (A, 120,00) no se distribuye acá, para que las consultas de coherencia den cero sobre lo que escribe cada propiedad.
}, 60_000);

const aDecimal = (centavos: bigint): string => {
  const t = centavos.toString().padStart(3, "0");
  return `${t.slice(0, t.length - 2)}.${t.slice(t.length - 2)}`;
};

/** Una imputación nueva de la sucursal A (en un renglón sin stock propio) con ese importe e IVA computable, en centavos. */
async function imputacion(totalCentavos: bigint, computableCentavos: bigint) {
  contador += 1;
  const total = aDecimal(totalCentavos);
  const computable = aDecimal(computableCentavos);
  const renglon = await prisma.facturaProveedorRenglon.create({ data: datosDeRenglonSinStock({ facturaProveedorId: e.facturaId, conceptoGastoId: e.conceptoId }, { orden: contador, precioTotal: total }) as never });
  const creada = await prisma.imputacionDeGasto.create({ data: { facturaProveedorRenglonId: renglon.id, sucursalId: e.sucursalA, importe: total, importeIvaComputable: computable } as never });
  return { id: creada.id, total, computable };
}

/** Los puntos básicos enteros (que suman 10000) de unos pesos, con el mismo reparto exacto por mayor residuo. */
const basicos = (pesos: readonly number[]) => repartirEnDosPasos(100, 0, pesos.map((peso, i) => ({ id: String(i).padStart(3, "0"), peso }))).map((p) => aCentavos(p.importe));

async function sumas(imputacionId: string) {
  const [s] = await prismaAdmin.$queryRaw<Array<{ importes: string | null; computables: string | null; basicos: bigint | null; lineas: bigint }>>`
    SELECT sum(l."importe")::text AS importes, sum(l."importeIvaComputable")::text AS computables, sum(l."porcentajeBp") AS basicos, count(l."id") AS lineas
      FROM "DistribucionCostoVersion" v JOIN "DistribucionCostoLinea" l ON l."distribucionCostoVersionId" = v."id" WHERE v."imputacionDeGastoId" = ${imputacionId}`;
  const [i] = await prismaAdmin.$queryRaw<Array<{ total: string; computable: string }>>`SELECT "importe"::text AS total, "importeIvaComputable"::text AS computable FROM "ImputacionDeGasto" WHERE id = ${imputacionId}`;
  return { ...s!, imputacion: i! };
}

const coherencia = async () => {
  const correr = (consulta: string) => prismaAdmin.$queryRawUnsafe<Array<{ id: string }>>(consulta);
  return {
    porcentaje: await correr(CONSULTAS_DE_COHERENCIA.porcentajeNoSuma100),
    importes: await correr(CONSULTAS_DE_COHERENCIA.importesNoSumanLoDeLaImputacion),
    noAplica: await correr(CONSULTAS_DE_COHERENCIA.planNoAplicaEnLaSucursal),
  };
};

/** Corre las sentencias en UNA transacción y devuelve «ok» o el error. */
async function bloque(c: Client, sentencias: Array<{ texto: string; params: unknown[] }>) {
  try {
    await c.query("BEGIN");
    for (const s of sentencias) await c.query(s.texto, s.params);
    await c.query("COMMIT");
    return "ok" as const;
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    return `${(error as { code?: string }).code}|${(error as { constraint?: string }).constraint}`;
  }
}

describe("el reparto del gasto entre centros suma EXACTO y el computable nunca pasa del importe (propiedades contra la base)", () => {
  it("para cualquier importe, computable y pesos: Σ importes = importe de la imputación, Σ computables = su IVA computable, Σ puntos básicos = 10000, cada computable ≤ su importe y la coherencia da cero", async (ctx) => {
    const hayRol = (await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = 'motor2_app'`)[0]!.n === BigInt(1);
    if (!hayRol) return ctx.skip();
    app = await conexionComoApp(undefined, { lectura: [e.sucursalA], escritura: [e.sucursalA] });
    await fc.assert(
      fc.asyncProperty(
        fc.bigInt({ min: BigInt(1), max: BigInt(99999999999) }), // importe en centavos
        fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom(1, 0.9999, 0.99, 0.5)), // qué parte es IVA computable (con casos pegados al límite computable = importe)
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 2, maxLength: 5 }),
        async (total, fraccion, pesos) => {
          const computable = BigInt(Math.floor(Number(total) * fraccion));
          const imp = await imputacion(total, computable);
          const bp = basicos(pesos);
          expect(bp.reduce((a, b) => a + b, 0), "los puntos básicos suman 10000").toBe(10000);
          fc.pre(bp.every((x) => x >= 1)); // un centro con 0 puntos básicos no es una línea válida
          const partes = bp.map((peso, i) => ({ id: centros[i]!, peso }));
          const reparto = repartirEnDosPasos(Number(imp.total), Number(imp.computable), partes);
          for (const p of reparto) expect(aCentavos(p.computable), "el computable de cada centro no pasa de su importe").toBeLessThanOrEqual(aCentavos(p.importe));
          const lineas = reparto.map((p) => ({ centroId: p.id, porcentajeBp: bp[partes.findIndex((x) => x.id === p.id)]!, importe: p.importe.toFixed(2), importeIvaComputable: p.computable.toFixed(2) }));
          const resultado = await bloque(app, sentenciasDeDistribucion({ imputacionId: imp.id, planId: e.planId, usuarioId: e.usuarioId }, {}, lineas));
          expect(resultado).toBe("ok");
          const s = await sumas(imp.id);
          expect(s.importes, "la suma en SQL de los importes es exactamente el importe de la imputación").toBe(s.imputacion.total);
          expect(s.computables, "la suma en SQL de los computables es exactamente el IVA computable de la imputación").toBe(s.imputacion.computable);
          expect(Number(s.basicos)).toBe(10000);
          expect(await coherencia(), "las tres consultas de coherencia dan cero filas").toEqual({ porcentaje: [], importes: [], noAplica: [] });
        },
      ),
      { numRuns: 25 },
    );
  }, 240_000);

  it("el resultado de cada centro no depende del orden en que se armaron las partes (se ordenan por id antes de repartir)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 99999999 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 2, maxLength: 5 }),
        fc.infiniteStream(fc.integer()),
        (totalCentavos, fraccion, pesos, azar) => {
          const partes = pesos.map((peso, i) => ({ id: centros[i]!, peso }));
          const barajadas = [...partes].map((p) => ({ p, k: azar.next().value as number })).sort((a, b) => a.k - b.k).map((x) => x.p);
          const total = totalCentavos / 100;
          const computable = Math.floor(totalCentavos * fraccion) / 100;
          expect(repartirEnDosPasos(total, computable, barajadas)).toEqual(repartirEnDosPasos(total, computable, partes));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("con UN solo centro al 100 % el reparto es la identidad: el importe y el computable enteros", async () => {
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: BigInt(1), max: BigInt(99999999999) }), fc.double({ min: 0, max: 1, noNaN: true }), async (total, fraccion) => {
        const computable = BigInt(Math.floor(Number(total) * fraccion));
        const imp = await imputacion(total, computable);
        const [unica] = repartirEnDosPasos(Number(imp.total), Number(imp.computable), [{ id: centros[0]!, peso: 10000 }]);
        await sembrarDistribucion(e, imp.id, [{ centroId: unica!.id, porcentajeBp: 10000, importe: unica!.importe.toFixed(2), importeIvaComputable: unica!.computable.toFixed(2) }]);
        const s = await sumas(imp.id);
        expect([s.importes, s.computables]).toEqual([imp.total, imp.computable]);
      }),
      { numRuns: 15 },
    );
  }, 60_000);

  it("100,00 con 21,00 de IVA en tres centros iguales: 33,34 / 33,33 / 33,33 con 7,00 de IVA cada uno, y el centavo de resto cae en el primer centro por id", async () => {
    const imp = await imputacion(BigInt(10000), BigInt(2100));
    const bp = basicos([1, 1, 1]);
    expect(bp).toEqual([3334, 3333, 3333]);
    const reparto = repartirEnDosPasos(100, 21, [0, 1, 2].map((i) => ({ id: centros[i]!, peso: bp[i]! })));
    expect(reparto.map((p) => [p.importe.toFixed(2), p.computable.toFixed(2)])).toEqual([["33.34", "7.00"], ["33.33", "7.00"], ["33.33", "7.00"]]);
    await sembrarDistribucion(e, imp.id, reparto.map((p, i) => ({ centroId: p.id, porcentajeBp: bp[i]!, importe: p.importe.toFixed(2), importeIvaComputable: p.computable.toFixed(2) })));
    expect(await sumas(imp.id)).toMatchObject({ importes: "100.00", computables: "21.00", basicos: BigInt(10000) });
  });
});

describe("lo que la base NO impide: entra, y la consulta de coherencia lo encuentra (la guarda vive en la Etapa C y en el chequeo posterior)", () => {
  /** Una imputación nueva de 100,00 con 10,00 de IVA computable y su id. */
  const nueva = () => imputacion(BigInt(10000), BigInt(1000));
  // Cada caso parte sin versiones (las consultas devuelven TODAS las incoherentes de la base): se borran como dueño, que es el único que puede.
  beforeEach(async () => {
    await prismaAdmin.distribucionCostoLinea.deleteMany();
    await prismaAdmin.distribucionCostoVersion.deleteMany();
  });

  it("una versión cuyos puntos básicos suman 9999 ENTRA; la consulta de porcentajes devuelve exactamente esa versión", async () => {
    const imp = await nueva();
    const versionId = await sembrarDistribucion(e, imp.id, [
      { centroId: e.centroUnAId, porcentajeBp: 5000, importe: "50.00", importeIvaComputable: "5.00" },
      { centroId: e.centroUnBId, porcentajeBp: 4999, importe: "50.00", importeIvaComputable: "5.00" },
    ]);
    expect((await coherencia()).porcentaje).toEqual([{ id: versionId }]);
    expect((await coherencia()).importes, "los importes sí suman lo de la imputación").toEqual([]);
  });

  it("una versión con 0,01 de más en el importe ENTRA (cada línea cumple su CHECK); la consulta de importes devuelve esa versión", async () => {
    const imp = await nueva();
    const versionId = await sembrarDistribucion(e, imp.id, [
      { centroId: e.centroUnAId, porcentajeBp: 5000, importe: "50.01", importeIvaComputable: "5.00" },
      { centroId: e.centroUnBId, porcentajeBp: 5000, importe: "50.00", importeIvaComputable: "5.00" },
    ]);
    expect((await coherencia()).importes).toEqual([{ id: versionId }]);
    // Lo mismo con el IVA computable.
    const imp2 = await nueva();
    const versionId2 = await sembrarDistribucion(e, imp2.id, [
      { centroId: e.centroUnAId, porcentajeBp: 5000, importe: "50.00", importeIvaComputable: "5.01" },
      { centroId: e.centroUnBId, porcentajeBp: 5000, importe: "50.00", importeIvaComputable: "5.00" },
    ]);
    expect((await coherencia()).importes.map((f) => f.id).sort()).toEqual([versionId, versionId2].sort());
  });

  it("una versión SIN líneas ENTRA (la cabecera sola), y las consultas la cuentan por el LEFT JOIN: ni suma 10000 ni suma el importe", async () => {
    const imp = await nueva();
    const versionId = await sembrarDistribucion(e, imp.id, []);
    const c = await coherencia();
    expect(c.porcentaje).toEqual([{ id: versionId }]);
    expect(c.importes).toEqual([{ id: versionId }]);
  });

  it("una versión de un plan que NO aplica en la sucursal de la imputación ENTRA; la tercera consulta la devuelve (con aplica=false y también sin fila)", async () => {
    const imp = await nueva();
    const versionId = await sembrarDistribucion(
      e, imp.id, [{ centroId: e.centroOtroPlanId, porcentajeBp: 10000, importe: "100.00", importeIvaComputable: "10.00" }], { planId: e.planOtroId },
    );
    expect((await coherencia()).noAplica, "el plan aplica en A: coherente").toEqual([]);
    await prismaAdmin.planDeCostosSucursal.updateMany({ where: { planDeCostosId: e.planOtroId, sucursalId: e.sucursalA }, data: { aplica: false } });
    expect((await coherencia()).noAplica).toEqual([{ id: versionId }]);
    await prismaAdmin.planDeCostosSucursal.deleteMany({ where: { planDeCostosId: e.planOtroId, sucursalId: e.sucursalA } });
    expect((await coherencia()).noAplica, "sin fila es lo mismo que aplica=false").toEqual([{ id: versionId }]);
  });
});

describe("el redondeo", () => {
  it("con pocos centavos, un centro con puntos básicos mayores que 0 puede quedar en 0,00 y la base lo acepta (el importe de una línea es cero o más)", async () => {
    const imp = await imputacion(BigInt(2), BigInt(1)); // 0,02 con 0,01 de IVA computable
    const bp = [3334, 3333, 3333];
    const reparto = repartirEnDosPasos(0.02, 0.01, [0, 1, 2].map((i) => ({ id: centros[i]!, peso: bp[i]! })));
    expect(reparto.map((p) => aCentavos(p.importe)).sort()).toEqual([0, 1, 1]);
    expect(reparto.filter((p) => aCentavos(p.importe) === 0)).toHaveLength(1);
    await sembrarDistribucion(e, imp.id, reparto.map((p) => ({ centroId: p.id, porcentajeBp: bp[centros.indexOf(p.id)]!, importe: p.importe.toFixed(2), importeIvaComputable: p.computable.toFixed(2) })));
    const s = await sumas(imp.id);
    expect([s.importes, s.computables, Number(s.basicos), Number(s.lineas)]).toEqual(["0.02", "0.01", 10000, 3]);
  });
});
