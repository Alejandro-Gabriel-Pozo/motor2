import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { planDeCostosAplica } from "../../src/core/compras/aplicabilidad-de-plan-de-costos";
import { sembrarEscenarioDeCentros, sentenciaDeLinea, sentenciaDeVersion, type EscenarioDeCentros } from "../setup/centros-de-costos";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, conexionDelDuenio, intentar } from "../setup/gasto";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 5, M7.2 — migración 20261019101000_distribucion_de_costos: la DISTRIBUCIÓN POR VERSIONES de la imputación de un gasto entre los centros de costos de un plan, contra la base real.
 *
 * Qué se mide: la estructura exacta (columnas, índices, las TRES claves foráneas de tres columnas con su definición, CHECK, RLS, privilegios; sin disparadores); las reglas (puntos básicos de 1 a 10000, importes con su CHECK, `numero` ≥ 1, motivo con un
 * carácter visible y hasta 200 y obligatorio desde la versión 2, una línea por (versión, centro)); la pertenencia (el centro y la línea son del plan de la versión: 23503 aun como dueño); que solo se agrega (UPDATE, DELETE y TRUNCATE dan 42501);
 * que distribuir no toca un solo importe de la imputación ni del renglón; y cuál es la versión vigente (la de `numero` mayor por imputación y plan; sin ninguna, «sin asignar»; con el plan sin aplicar, «no aplica»).
 * La RLS por sucursal la mide `centros-de-costos-rls`; la concurrencia, la idempotencia y la atomicidad, `distribucion-de-costos-concurrencia`; la suma exacta, `distribucion-de-costos-dinero`; subir, bajar y subir, `paquete-3-m4-subir-bajar-subir`.
 *
 * Mutaciones demostradas (ver las filas O.300 a O.309 de docs/pureza-integracion.md): clave foránea de la línea al centro con dos columnas (sin el plan), `GRANT UPDATE` o `DELETE` en la versión, `BETWEEN 0 AND 10000`, sacar `motivo_en_correccion_chk`.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261019101000_distribucion_de_costos");
const FK_LINEA_VERSION = "DistribucionCostoLinea_empresaId_distribucionCostoVersionI_fkey";
const FK_LINEA_CENTRO = "DistribucionCostoLinea_empresaId_planDeCostosId_centroDeCo_fkey";
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);
const probar = (c: Parameters<typeof intentar>[0], s: { texto: string; params: unknown[] }) => intentar(c, s.texto, s.params);

let e: EscenarioDeCentros;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeCentros();
});
afterEach(cerrarConexiones);

const cuantos = async (tabla: string, filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);
const deA = () => conexionComoApp(undefined, { lectura: [e.sucursalA], escritura: [e.sucursalA] });
const version = (extra: Record<string, unknown> = {}, quien: Partial<{ imputacionId: string; planId: string }> = {}) =>
  sentenciaDeVersion({ imputacionId: quien.imputacionId ?? e.imputacionAId, planId: quien.planId ?? e.planId, usuarioId: e.usuarioId }, extra);
/** Una versión completa (100 % al centro A del plan) escrita como DUEÑO: devuelve el id de la versión. */
async function versionCompleta(numero: number, extra: Record<string, unknown> = {}) {
  const duenio = await conexionDelDuenio();
  const v = version({ numero, motivo: numero > 1 ? "Corrección de la distribución" : null, empresaId: EMPRESA_DE_PRUEBA_ID, ...extra });
  expect(await probar(duenio, v)).toBeNull();
  const l = sentenciaDeLinea({ versionId: v.id, planId: e.planId, centroId: e.centroUnAId }, { empresaId: EMPRESA_DE_PRUEBA_ID });
  expect(await probar(duenio, l)).toBeNull();
  return v.id;
}

describe("la migración deja las tablas, los índices, las claves foráneas, las reglas, la RLS y los privilegios puestos", () => {
  it("tiene las columnas esperadas, con su tipo y su nulabilidad; el dinero es numeric(14,2) y los porcentajes son enteros", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string; tipo: string; es_nulable: string; por_defecto: string | null; precision: number | null; escala: number | null }>>`
      SELECT table_name::text AS tabla, column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, column_default AS por_defecto, numeric_precision AS precision, numeric_scale AS escala
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('DistribucionCostoVersion', 'DistribucionCostoLinea') ORDER BY table_name, ordinal_position`;
    const forma = (tabla: string) => columnas.filter((c) => c.tabla === tabla).map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`);
    expect(forma("DistribucionCostoVersion")).toEqual([
      "id:text:NO", "empresaId:text:NO", "imputacionDeGastoId:text:NO", "planDeCostosId:text:NO", "numero:integer:NO", "motivo:text:YES", "claveIdempotencia:text:NO", "payloadHash:text:NO", "resultadoMensaje:text:NO",
      "creadoPorId:text:NO", "creadoEn:timestamp without time zone:NO",
    ]);
    expect(forma("DistribucionCostoLinea")).toEqual([
      "id:text:NO", "empresaId:text:NO", "distribucionCostoVersionId:text:NO", "planDeCostosId:text:NO", "centroDeCostosId:text:NO", "porcentajeBp:integer:NO", "importe:numeric:NO", "importeIvaComputable:numeric:NO",
    ]);
    const dinero = columnas.filter((c) => c.tipo === "numeric");
    expect(dinero.map((c) => `${c.columna}(${c.precision},${c.escala})`)).toEqual(["importe(14,2)", "importeIvaComputable(14,2)"]);
    expect(columnas.filter((c) => /double|real|money/.test(c.tipo))).toEqual([]);
    expect(columnas.find((c) => c.columna === "importeIvaComputable")!.por_defecto).toMatch(/^0/);
    for (const c of columnas.filter((x) => x.columna === "empresaId")) expect(c.por_defecto, c.tabla).toMatch(/app_empresa_actual\(\)/);
  });

  it("los índices únicos y de consulta son los esperados (el de «numero» y el de la línea con nombre explícito)", async () => {
    const indices = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; unico: boolean; definicion: string }>>`
      SELECT c.relname::text AS tabla, ic.relname::text AS nombre, i.indisunique AS unico, pg_get_indexdef(i.indexrelid) AS definicion
        FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
       WHERE c.relname IN ('DistribucionCostoVersion', 'DistribucionCostoLinea') AND NOT i.indisprimary ORDER BY 1, 2`;
    expect(indices.map((i) => `${i.tabla}|${i.nombre}|${i.unico}`)).toEqual([
      "DistribucionCostoLinea|DistribucionCostoLinea_centroDeCostosId_idx|false",
      "DistribucionCostoLinea|DistribucionCostoLinea_empresaId_id_key|true",
      "DistribucionCostoLinea|DistribucionCostoLinea_version_centro_key|true",
      "DistribucionCostoVersion|DistribucionCostoVersion_claveIdempotencia_key|true",
      "DistribucionCostoVersion|DistribucionCostoVersion_empresaId_id_key|true",
      "DistribucionCostoVersion|DistribucionCostoVersion_empresaId_id_planDeCostosId_key|true",
      "DistribucionCostoVersion|DistribucionCostoVersion_imputacion_plan_numero_key|true",
      "DistribucionCostoVersion|DistribucionCostoVersion_planDeCostosId_idx|false",
    ]);
    const definicion = (n: string) => indices.find((i) => i.nombre === n)!.definicion;
    expect(definicion("DistribucionCostoVersion_imputacion_plan_numero_key")).toMatch(/\("imputacionDeGastoId", "planDeCostosId", numero\)/);
    expect(definicion("DistribucionCostoVersion_empresaId_id_planDeCostosId_key"), "destino de la clave foránea de la línea").toMatch(/\("empresaId", id, "planDeCostosId"\)/);
    expect(definicion("DistribucionCostoLinea_version_centro_key")).toMatch(/\("distribucionCostoVersionId", "centroDeCostosId"\)/);
  });

  it("las claves foráneas son RESTRICT; las dos de la línea llevan el PLAN como discriminador (tres columnas) y ON UPDATE RESTRICT", async () => {
    const fks = await prismaAdmin.$queryRaw<Array<{ nombre: string; definicion: string }>>`
      SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
       WHERE conrelid IN ('"DistribucionCostoVersion"'::regclass, '"DistribucionCostoLinea"'::regclass) AND contype = 'f'`;
    expect(fks.map((f) => f.nombre).sort()).toEqual(
      [
        "DistribucionCostoVersion_empresaId_fkey", "DistribucionCostoVersion_empresaId_imputacionDeGastoId_fkey", "DistribucionCostoVersion_empresaId_planDeCostosId_fkey", "DistribucionCostoVersion_creadoPorId_fkey",
        "DistribucionCostoLinea_empresaId_fkey", FK_LINEA_VERSION, FK_LINEA_CENTRO,
      ].sort(),
    );
    for (const f of fks) expect(f.definicion, f.nombre).toMatch(/ON DELETE RESTRICT/);
    const def = (n: string) => fks.find((f) => f.nombre === n)!.definicion;
    expect(def(FK_LINEA_VERSION)).toBe(
      'FOREIGN KEY ("empresaId", "distribucionCostoVersionId", "planDeCostosId") REFERENCES "DistribucionCostoVersion"("empresaId", id, "planDeCostosId") ON UPDATE RESTRICT ON DELETE RESTRICT',
    );
    expect(def(FK_LINEA_CENTRO)).toBe(
      'FOREIGN KEY ("empresaId", "planDeCostosId", "centroDeCostosId") REFERENCES "CentroDeCostos"("empresaId", "planDeCostosId", id) ON UPDATE RESTRICT ON DELETE RESTRICT',
    );
    expect(def("DistribucionCostoVersion_empresaId_imputacionDeGastoId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "imputacionDeGastoId"\) REFERENCES "ImputacionDeGasto"\("empresaId", id\)/);
    expect(def("DistribucionCostoVersion_empresaId_planDeCostosId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "planDeCostosId"\) REFERENCES "PlanDeCostos"\("empresaId", id\)/);
    expect(def("DistribucionCostoVersion_creadoPorId_fkey")).toMatch(/FOREIGN KEY \("creadoPorId"\) REFERENCES "User"\(id\)/);
  });

  it("los CHECK están puestos y validados, y no hay ningún disparador en las dos tablas (la base no suma filas: lo valida la Etapa C)", async () => {
    const checks = await prismaAdmin.$queryRaw<Array<{ nombre: string; validada: boolean }>>`
      SELECT conname::text AS nombre, convalidated AS validada FROM pg_constraint
       WHERE conrelid IN ('"DistribucionCostoVersion"'::regclass, '"DistribucionCostoLinea"'::regclass) AND contype = 'c' ORDER BY 1`;
    expect(checks).toEqual([
      { nombre: "DistribucionCostoLinea_importe_chk", validada: true },
      { nombre: "DistribucionCostoLinea_iva_computable_chk", validada: true },
      { nombre: "DistribucionCostoLinea_porcentaje_chk", validada: true },
      { nombre: "DistribucionCostoVersion_motivo_chk", validada: true },
      { nombre: "DistribucionCostoVersion_motivo_en_correccion_chk", validada: true },
      { nombre: "DistribucionCostoVersion_numero_chk", validada: true },
    ]);
    const disparadores = await prismaAdmin.$queryRaw<Array<{ nombre: string }>>`
      SELECT tgname::text AS nombre FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('"DistribucionCostoVersion"'::regclass, '"DistribucionCostoLinea"'::regclass)`;
    expect(disparadores).toEqual([]);
  });

  it("la RLS por empresa está puesta, sin FORCE; cada tabla tiene `aislamiento_empresa` más las 4 de sucursal de M7.3 (RESTRICTIVE para motor2_app)", async () => {
    const rls = await prismaAdmin.$queryRaw<Array<{ tabla: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relname::text AS tabla, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid IN ('"DistribucionCostoVersion"'::regclass, '"DistribucionCostoLinea"'::regclass) ORDER BY 1`;
    expect(rls).toEqual(["DistribucionCostoLinea", "DistribucionCostoVersion"].map((tabla) => ({ tabla, relrowsecurity: true, relforcerowsecurity: false })));
    const politicas = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; qual: string | null; permissive: string }>>`
      SELECT tablename::text AS tabla, policyname::text AS nombre, qual, permissive FROM pg_policies WHERE tablename IN ('DistribucionCostoVersion', 'DistribucionCostoLinea') ORDER BY 1, 2`;
    for (const tabla of ["DistribucionCostoLinea", "DistribucionCostoVersion"]) {
      const de = politicas.filter((p) => p.tabla === tabla);
      expect(de.map((p) => p.nombre), tabla).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
      expect(/app_empresa_actual/.test(de.find((p) => p.nombre === "aislamiento_empresa")!.qual ?? "")).toBe(true);
    }
  });

  it("SOLO se agrega: motor2_app tiene SELECT e INSERT y NINGÚN UPDATE (ni por columna) ni DELETE; motor2_plataforma, nada", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const filas = await prismaAdmin.$queryRaw<Array<{ tabla: string; rol: string; privilegio: string }>>`
      SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name IN ('DistribucionCostoVersion', 'DistribucionCostoLinea') AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`;
    expect(filas.map((f) => `${f.tabla}|${f.rol}|${f.privilegio}`)).toEqual([
      "DistribucionCostoLinea|motor2_app|INSERT", "DistribucionCostoLinea|motor2_app|SELECT", "DistribucionCostoVersion|motor2_app|INSERT", "DistribucionCostoVersion|motor2_app|SELECT",
    ]);
    const conUpdate = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string }>>`
      SELECT a.attrelid::regclass::text AS tabla, a.attname::text AS columna FROM pg_attribute a
       WHERE a.attrelid IN ('"DistribucionCostoVersion"'::regclass, '"DistribucionCostoLinea"'::regclass) AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE')`;
    expect(conUpdate).toEqual([]);
  });

  it("el migration.sql y el down.sql avisan que requieren autorización y que la reversa aborta con filas, y no se disfrazan de migración de políticas de sucursal", () => {
    const subida = readFileSync(join(CARPETA, "migration.sql"), "utf8");
    expect(subida.split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    const reversa = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(reversa).toMatch(/ABORTA/);
    expect(reversa).toContain('DROP TABLE IF EXISTS "DistribucionCostoLinea"');
    expect(reversa).toContain('DROP TABLE IF EXISTS "DistribucionCostoVersion"');
    for (const sql of [subida, reversa]) {
      expect(sql).not.toContain("alcance_sucursal_");
      expect(sql).not.toContain("app_sucursales_");
    }
  });
});

describe("las reglas de la distribución", () => {
  it("los puntos básicos van de 1 a 10000: 0, -1 y 10001 dan 23514 (…_porcentaje_chk); 1 y 10000 entran", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await deA();
    const v = version();
    expect(await probar(app, v)).toBeNull();
    for (const malo of [0, -1, 10001]) {
      const l = sentenciaDeLinea({ versionId: v.id, planId: e.planId, centroId: e.centroUnAId }, { porcentajeBp: malo });
      expect(await probar(app, l), String(malo)).toEqual({ codigo: "23514", restriccion: "DistribucionCostoLinea_porcentaje_chk" });
    }
    expect(await probar(app, sentenciaDeLinea({ versionId: v.id, planId: e.planId, centroId: e.centroUnAId }, { porcentajeBp: 1 }))).toBeNull();
    expect(await probar(app, sentenciaDeLinea({ versionId: v.id, planId: e.planId, centroId: e.centroUnBId }, { porcentajeBp: 10000 }))).toBeNull();
  });

  it("el importe es cero o más (-0,01 da 23514; 0,00 entra: el redondeo puede dejar un centro en cero) y el IVA computable va de 0 al importe (mayor que el importe o negativo da 23514)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await deA();
    const v = version();
    expect(await probar(app, v)).toBeNull();
    const linea = (centroId: string, extra: Record<string, unknown>) => sentenciaDeLinea({ versionId: v.id, planId: e.planId, centroId }, extra);
    expect(await probar(app, linea(e.centroUnAId, { importe: "-0.01", importeIvaComputable: "0" }))).toEqual({ codigo: "23514", restriccion: "DistribucionCostoLinea_importe_chk" });
    expect(await probar(app, linea(e.centroUnAId, { importe: "10.00", importeIvaComputable: "10.01" }))).toEqual({ codigo: "23514", restriccion: "DistribucionCostoLinea_iva_computable_chk" });
    expect(await probar(app, linea(e.centroUnAId, { importe: "10.00", importeIvaComputable: "-0.01" }))).toEqual({ codigo: "23514", restriccion: "DistribucionCostoLinea_iva_computable_chk" });
    expect(await probar(app, linea(e.centroUnAId, { importe: "0.00", importeIvaComputable: "0.00" }))).toBeNull();
    expect(await probar(app, linea(e.centroUnBId, { importe: "10.00", importeIvaComputable: "10.00" }))).toBeNull();
  });

  it("`numero` es 1 o más: 0 y -1 dan 23514 (…_numero_chk); el 1 entra", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await deA();
    for (const malo of [0, -1]) expect(await probar(app, version({ numero: malo, motivo: "x" })), String(malo)).toEqual({ codigo: "23514", restriccion: "DistribucionCostoVersion_numero_chk" });
    expect(await probar(app, version({ numero: 1 }))).toBeNull();
  });

  it("el motivo es NULL o tiene un carácter visible y hasta 200: blancos, tabulador y 201 dan 23514; 200 entra", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await deA();
    for (const malo of ["", "  ", "\t\n", "x".repeat(201)]) {
      expect(await probar(app, version({ numero: 2, motivo: malo })), JSON.stringify(malo.slice(0, 5)) + malo.length).toEqual({ codigo: "23514", restriccion: "DistribucionCostoVersion_motivo_chk" });
    }
    expect(await probar(app, version({ numero: 2, motivo: "x".repeat(200) }))).toBeNull();
    expect(await probar(app, version({ numero: 3, motivo: "  ok  " }))).toBeNull();
  });

  it("la versión 2 y siguientes EXIGEN motivo (23514 …_motivo_en_correccion_chk); la versión 1 entra sin motivo", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await deA();
    expect(await probar(app, version({ numero: 1, motivo: null }))).toBeNull();
    for (const n of [2, 3]) expect(await probar(app, version({ numero: n, motivo: null })), String(n)).toEqual({ codigo: "23514", restriccion: "DistribucionCostoVersion_motivo_en_correccion_chk" });
    expect(await cuantos("DistribucionCostoVersion")).toBe(1);
  });

  it("un centro una sola vez por versión (23505 …_version_centro_key) y la huella, el mensaje y la clave son obligatorios (23502)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await deA();
    const v = version();
    expect(await probar(app, v)).toBeNull();
    expect(await probar(app, sentenciaDeLinea({ versionId: v.id, planId: e.planId, centroId: e.centroUnAId }, { porcentajeBp: 5000 }))).toBeNull();
    expect(await probar(app, sentenciaDeLinea({ versionId: v.id, planId: e.planId, centroId: e.centroUnAId }, { porcentajeBp: 5000 }))).toEqual({ codigo: "23505", restriccion: "DistribucionCostoLinea_version_centro_key" });
    for (const columna of ["payloadHash", "resultadoMensaje", "claveIdempotencia", "creadoPorId"]) {
      expect(await probar(app, version({ [columna]: null })), columna).toMatchObject({ codigo: "23502" });
    }
  });
});

describe("la pertenencia: el centro y la línea son del plan de la versión, aun escribiendo como DUEÑO", () => {
  it("una línea con un centro de OTRO plan da 23503 (la clave foránea de tres columnas); con un centro del plan de la versión entra", async () => {
    const duenio = await conexionDelDuenio();
    const v = version({ empresaId: EMPRESA_DE_PRUEBA_ID });
    expect(await probar(duenio, v)).toBeNull();
    const deOtroPlan = sentenciaDeLinea({ versionId: v.id, planId: e.planId, centroId: e.centroOtroPlanId }, { empresaId: EMPRESA_DE_PRUEBA_ID });
    expect(await probar(duenio, deOtroPlan)).toEqual({ codigo: "23503", restriccion: FK_LINEA_CENTRO });
    expect(await probar(duenio, sentenciaDeLinea({ versionId: v.id, planId: e.planId, centroId: e.centroUnAId }, { empresaId: EMPRESA_DE_PRUEBA_ID }))).toBeNull();
    expect(await cuantos("DistribucionCostoLinea")).toBe(1);
  });

  it("una línea con un `planDeCostosId` distinto del de su versión da 23503 (la clave foránea hacia la versión), aunque el centro sea de ese otro plan", async () => {
    const duenio = await conexionDelDuenio();
    const v = version({ empresaId: EMPRESA_DE_PRUEBA_ID });
    expect(await probar(duenio, v)).toBeNull();
    const otroPlan = sentenciaDeLinea({ versionId: v.id, planId: e.planOtroId, centroId: e.centroOtroPlanId }, { empresaId: EMPRESA_DE_PRUEBA_ID });
    expect(await probar(duenio, otroPlan)).toEqual({ codigo: "23503", restriccion: FK_LINEA_VERSION });
    expect(await cuantos("DistribucionCostoLinea")).toBe(0);
  });

  it("una versión de una imputación inexistente, de un plan inexistente o de un usuario inexistente da 23503", async () => {
    const duenio = await conexionDelDuenio();
    expect(await probar(duenio, version({ empresaId: EMPRESA_DE_PRUEBA_ID, imputacionDeGastoId: "no-existe" }))).toEqual({ codigo: "23503", restriccion: "DistribucionCostoVersion_empresaId_imputacionDeGastoId_fkey" });
    expect(await probar(duenio, version({ empresaId: EMPRESA_DE_PRUEBA_ID, planDeCostosId: "no-existe" }))).toEqual({ codigo: "23503", restriccion: "DistribucionCostoVersion_empresaId_planDeCostosId_fkey" });
    expect(await probar(duenio, version({ empresaId: EMPRESA_DE_PRUEBA_ID, creadoPorId: "no-existe" }))).toEqual({ codigo: "23503", restriccion: "DistribucionCostoVersion_creadoPorId_fkey" });
  });

  it("una imputación, un plan o un centro de OTRA empresa dan 23503 (clave foránea compuesta con empresaId)", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const planAjeno = await ajeno.testigo.planDeCostos.create({ data: { codigo: "PLAN_T", nombre: "Plan testigo" } });
    const duenio = await conexionDelDuenio();
    expect(await probar(duenio, version({ empresaId: EMPRESA_DE_PRUEBA_ID, planDeCostosId: planAjeno.id }))).toEqual({ codigo: "23503", restriccion: "DistribucionCostoVersion_empresaId_planDeCostosId_fkey" });
    expect(await probar(duenio, version({ empresaId: EMPRESA_TESTIGO_ID }))).toEqual({ codigo: "23503", restriccion: "DistribucionCostoVersion_empresaId_imputacionDeGastoId_fkey" });
  });

  it("no se pueden borrar (RESTRICT, ni como dueño) una imputación, un plan, un centro ni un usuario referenciados", async () => {
    await versionCompleta(1);
    const duenio = await conexionDelDuenio();
    expect(await intentar(duenio, `DELETE FROM "ImputacionDeGasto" WHERE "id" = $1`, [e.imputacionAId])).toEqual({ codigo: "23503", restriccion: "DistribucionCostoVersion_empresaId_imputacionDeGastoId_fkey" });
    expect(await intentar(duenio, `DELETE FROM "CentroDeCostos" WHERE "id" = $1`, [e.centroUnAId])).toEqual({ codigo: "23503", restriccion: FK_LINEA_CENTRO });
    expect(await intentar(duenio, `DELETE FROM "PlanDeCostos" WHERE "id" = $1`, [e.planId])).toMatchObject({ codigo: "23503" });
    expect(await intentar(duenio, `DELETE FROM "User" WHERE "id" = $1`, [e.usuarioId])).toMatchObject({ codigo: "23503" });
    expect(await intentar(duenio, `DELETE FROM "DistribucionCostoVersion"`)).toEqual({ codigo: "23503", restriccion: FK_LINEA_VERSION });
    expect([await cuantos("DistribucionCostoVersion"), await cuantos("DistribucionCostoLinea")]).toEqual([1, 1]);
  });
});

describe("solo se agrega: la app no modifica ni borra una versión ni una línea", () => {
  it("UPDATE de cualquier columna, DELETE y TRUNCATE de la versión y de la línea dan 42501 y las filas quedan intactas", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const versionId = await versionCompleta(1);
    const lineaId = (await prismaAdmin.distribucionCostoLinea.findFirstOrThrow({ where: { distribucionCostoVersionId: versionId } })).id;
    const antes = [await prismaAdmin.distribucionCostoVersion.findUniqueOrThrow({ where: { id: versionId } }), await prismaAdmin.distribucionCostoLinea.findUniqueOrThrow({ where: { id: lineaId } })];
    const app = await deA();
    const deVersion: Array<[string, string]> = [
      ["imputacionDeGastoId", `'${e.imputacionBId}'`], ["planDeCostosId", `'${e.planOtroId}'`], ["numero", "7"], ["motivo", "'otro'"], ["claveIdempotencia", `'${randomUUID()}'`], ["payloadHash", "'otra'"],
      ["resultadoMensaje", "'otro'"], ["creadoPorId", `'${e.usuarioId}'`], ["creadoEn", "now()"], ["empresaId", `'${EMPRESA_TESTIGO_ID}'`], ["id", `'${randomUUID()}'`],
    ];
    for (const [columna, valor] of deVersion) expect(await intentar(app, `UPDATE "DistribucionCostoVersion" SET "${columna}" = ${valor} WHERE "id" = $1`, [versionId]), `versión.${columna}`).toMatchObject({ codigo: "42501" });
    const deLinea: Array<[string, string]> = [
      ["distribucionCostoVersionId", `'${versionId}'`], ["planDeCostosId", `'${e.planOtroId}'`], ["centroDeCostosId", `'${e.centroUnBId}'`], ["porcentajeBp", "5000"], ["importe", "1.00"], ["importeIvaComputable", "0"],
      ["empresaId", `'${EMPRESA_TESTIGO_ID}'`], ["id", `'${randomUUID()}'`],
    ];
    for (const [columna, valor] of deLinea) expect(await intentar(app, `UPDATE "DistribucionCostoLinea" SET "${columna}" = ${valor} WHERE "id" = $1`, [lineaId]), `línea.${columna}`).toMatchObject({ codigo: "42501" });
    for (const tabla of ["DistribucionCostoVersion", "DistribucionCostoLinea"]) {
      expect(await intentar(app, `DELETE FROM "${tabla}"`), `DELETE ${tabla}`).toMatchObject({ codigo: "42501" });
      expect(await intentar(app, `TRUNCATE "${tabla}"`), `TRUNCATE ${tabla}`).toMatchObject({ codigo: "42501" });
    }
    expect([await prismaAdmin.distribucionCostoVersion.findUniqueOrThrow({ where: { id: versionId } }), await prismaAdmin.distribucionCostoLinea.findUniqueOrThrow({ where: { id: lineaId } })]).toEqual(antes);
  });

  it("DINERO INTACTO: tres versiones no cambian ni el importe ni el IVA computable de la imputación, ni nada del renglón", async () => {
    const foto = async () => ({
      renglon: await prismaAdmin.$queryRaw`SELECT "id", "precioTotal"::text AS "precioTotal", "importeIvaComputable"::text AS "importeIvaComputable", "tipoDeCosto", "conceptoGastoId", "naturaleza" FROM "FacturaProveedorRenglon" ORDER BY "id"`,
      imputaciones: await prismaAdmin.$queryRaw`SELECT "id", "importe"::text AS "importe", "importeIvaComputable"::text AS "importeIvaComputable", "sucursalId" FROM "ImputacionDeGasto" ORDER BY "id"`,
      sumas: await prismaAdmin.$queryRaw`SELECT sum("importe")::text AS "importe", sum("importeIvaComputable")::text AS "iva" FROM "ImputacionDeGasto"`,
    });
    const antes = await foto();
    await versionCompleta(1);
    await versionCompleta(2);
    await versionCompleta(3);
    expect(await cuantos("DistribucionCostoVersion")).toBe(3);
    expect(await foto()).toEqual(antes);
    expect(antes.sumas).toEqual([{ importe: "200.00", iva: "20.00" }]);
  });
});

describe("la versión vigente y los tres estados (sin asignar, vigente, no aplica)", () => {
  const vigentes = () =>
    prismaAdmin.$queryRaw<Array<{ imputacion: string; plan: string; numero: number }>>`
      SELECT DISTINCT ON ("imputacionDeGastoId", "planDeCostosId") "imputacionDeGastoId" AS imputacion, "planDeCostosId" AS plan, "numero"
        FROM "DistribucionCostoVersion" ORDER BY "imputacionDeGastoId", "planDeCostosId", "numero" DESC`;

  it("con las versiones 1, 2 y 3 (cargadas en cualquier orden) la vigente es la de número mayor", async () => {
    await versionCompleta(2);
    await versionCompleta(1);
    expect(await vigentes()).toEqual([{ imputacion: e.imputacionAId, plan: e.planId, numero: 2 }]);
    await versionCompleta(3);
    expect(await vigentes()).toEqual([{ imputacion: e.imputacionAId, plan: e.planId, numero: 3 }]);
  });

  it("cada (imputación, plan) tiene su propia serie: las versiones de otro plan o de otra imputación no se pisan", async () => {
    const duenio = await conexionDelDuenio();
    await versionCompleta(1);
    await versionCompleta(2);
    const otroPlan = version({ empresaId: EMPRESA_DE_PRUEBA_ID }, { planId: e.planOtroId });
    expect(await probar(duenio, otroPlan)).toBeNull();
    const deB = version({ empresaId: EMPRESA_DE_PRUEBA_ID }, { imputacionId: e.imputacionBId });
    expect(await probar(duenio, deB)).toBeNull();
    const ordenadas = (await vigentes()).map((v) => `${v.imputacion}|${v.plan}|${v.numero}`).sort();
    expect(ordenadas).toEqual([`${e.imputacionAId}|${e.planId}|2`, `${e.imputacionAId}|${e.planOtroId}|1`, `${e.imputacionBId}|${e.planId}|1`].sort());
  });

  it("sin ninguna versión el estado es «sin asignar»: la consulta de vigentes no devuelve filas, y la aplicabilidad dice que el plan sí aplica", async () => {
    expect(await vigentes()).toEqual([]);
    const aplicabilidad = await prismaAdmin.planDeCostosSucursal.findFirst({ where: { planDeCostosId: e.planId, sucursalId: e.sucursalA } });
    expect(planDeCostosAplica(aplicabilidad)).toBe(true);
  });

  it("«no aplica»: un plan sin fila en la sucursal y uno con `aplica = false` dan lo mismo (el embudo), y nunca es «sin asignar»", async () => {
    await prismaAdmin.planDeCostosSucursal.updateMany({ where: { planDeCostosId: e.planId, sucursalId: e.sucursalA }, data: { aplica: false } });
    await prismaAdmin.planDeCostosSucursal.deleteMany({ where: { planDeCostosId: e.planOtroId, sucursalId: e.sucursalA } });
    const conFalse = await prismaAdmin.planDeCostosSucursal.findFirst({ where: { planDeCostosId: e.planId, sucursalId: e.sucursalA } });
    const sinFila = await prismaAdmin.planDeCostosSucursal.findFirst({ where: { planDeCostosId: e.planOtroId, sucursalId: e.sucursalA } });
    expect(conFalse).not.toBeNull();
    expect(sinFila).toBeNull();
    expect(planDeCostosAplica(conFalse)).toBe(false);
    expect(planDeCostosAplica(sinFila)).toBe(false);
    expect(planDeCostosAplica(conFalse)).toBe(planDeCostosAplica(sinFila));
    // En la otra sucursal el plan sigue aplicando.
    expect(planDeCostosAplica(await prismaAdmin.planDeCostosSucursal.findFirst({ where: { planDeCostosId: e.planId, sucursalId: e.sucursalB } }))).toBe(true);
  });
});
