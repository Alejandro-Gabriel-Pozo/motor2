import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { sembrarAjeno } from "../setup/factura-proveedor";
import { cerrarConexiones, conexionComoApp, conexionDelDuenio, intentar } from "../setup/gasto";
import { sembrarEscenarioDeCentros, sentenciaDeInsercion, type EscenarioDeCentros } from "../setup/centros-de-costos";
import { limpiarBaseDeTest, prisma, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 5, M7.1 — migración 20261019100000_planes_y_centros_de_costos: los PLANES y CENTROS DE COSTOS de la empresa (unidades de negocio) y en qué sucursales APLICA cada plan, contra la base real.
 *
 * Qué se mide: la estructura exacta (columnas, índices incluidos los dos de `lower`, claves foráneas con la definición exacta de las de tres columnas, CHECK, RLS, privilegios de tabla y por columna); las reglas (formato del código, nombre con algo
 * visible y hasta 120, nombre único sin importar mayúsculas, un centro sin padre en la v1, una aplicabilidad por (plan, sucursal)); la pertenencia (un centro o una aplicabilidad con el plan de OTRA empresa dan 23503, aun como dueño; plan, centro,
 * sucursal y usuario referenciados no se borran); y que la app solo cambia `nombre` y `activo` (y `aplica`): UPDATE de `codigo`, `planDeCostosId` o `sucursalId` y todo DELETE dan 42501.
 * Las políticas de sucursal de la aplicabilidad las mide `centros-de-costos-rls`; la distribución, `migracion-distribucion-de-costos`; la concurrencia del catálogo, `distribucion-de-costos-concurrencia`.
 *
 * Mutaciones demostradas (ver las filas O.300 a O.309 de docs/pureza-integracion.md): sacar `CentroDeCostos_sin_padre_chk`, `GRANT UPDATE ("codigo")` en el plan, sacar un `ENABLE ROW LEVEL SECURITY`.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261019100000_planes_y_centros_de_costos");
const FK_PADRE = "CentroDeCostos_empresaId_planDeCostosId_centroPadreId_fkey";
const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);
const TABLAS = ["PlanDeCostos", "CentroDeCostos", "PlanDeCostosSucursal"] as const;

let e: EscenarioDeCentros;
beforeEach(async () => {
  await limpiarBaseDeTest();
  e = await sembrarEscenarioDeCentros();
});
afterEach(cerrarConexiones);

const cuantos = async (tabla: string, filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${tabla}" WHERE ${filtro}`))[0]!.n);
const plan = (extra: Record<string, unknown> = {}) => sentenciaDeInsercion("PlanDeCostos", { id: randomUUID(), codigo: "PLAN_NUEVO", nombre: "Plan nuevo", ...extra });
const centro = (extra: Record<string, unknown> = {}) => sentenciaDeInsercion("CentroDeCostos", { id: randomUUID(), planDeCostosId: e.planId, codigo: "UN_NUEVA", nombre: "Unidad nueva", ...extra });
/** Corre una sentencia armada con `sentenciaDeInsercion` en su propia transacción: `null` si anduvo, o el SQLSTATE y la restricción con que se rechazó. */
const probar = (c: Parameters<typeof intentar>[0], s: { texto: string; params: unknown[] }) => intentar(c, s.texto, s.params);
const aplicabilidad = (extra: Record<string, unknown> = {}) => sentenciaDeInsercion("PlanDeCostosSucursal", { id: randomUUID(), planDeCostosId: e.planId, sucursalId: e.sucursalA, aplica: true, ...extra });

describe("la migración deja las tablas, los índices, las claves foráneas, las reglas, la RLS y los privilegios puestos", () => {
  it("tiene las columnas esperadas de las tres tablas, con su tipo y su nulabilidad; NINGUNA es de dinero", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ tabla: string; columna: string; tipo: string; es_nulable: string; por_defecto: string | null }>>`
      SELECT table_name::text AS tabla, column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, column_default AS por_defecto
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('PlanDeCostos', 'CentroDeCostos', 'PlanDeCostosSucursal') ORDER BY table_name, ordinal_position`;
    const de = (tabla: string) => columnas.filter((c) => c.tabla === tabla);
    const forma = (tabla: string) => de(tabla).map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`);
    expect(forma("PlanDeCostos")).toEqual(["id:text:NO", "empresaId:text:NO", "codigo:text:NO", "nombre:text:NO", "activo:boolean:NO", "creadoEn:timestamp without time zone:NO"]);
    expect(forma("CentroDeCostos")).toEqual(["id:text:NO", "empresaId:text:NO", "planDeCostosId:text:NO", "codigo:text:NO", "nombre:text:NO", "centroPadreId:text:YES", "activo:boolean:NO", "creadoEn:timestamp without time zone:NO"]);
    expect(forma("PlanDeCostosSucursal")).toEqual(["id:text:NO", "empresaId:text:NO", "planDeCostosId:text:NO", "sucursalId:text:NO", "aplica:boolean:NO", "creadoEn:timestamp without time zone:NO"]);
    expect(columnas.filter((c) => /numeric|double|real|money/.test(c.tipo))).toEqual([]);
    for (const tabla of TABLAS) {
      expect(de(tabla).find((c) => c.columna === "empresaId")!.por_defecto, tabla).toMatch(/app_empresa_actual\(\)/);
      expect(de(tabla).find((c) => c.columna === "creadoEn")!.por_defecto, tabla).toMatch(/CURRENT_TIMESTAMP/);
    }
    expect(de("PlanDeCostos").find((c) => c.columna === "activo")!.por_defecto).toBe("true");
    expect(de("PlanDeCostosSucursal").find((c) => c.columna === "aplica")!.por_defecto, "`aplica` se elige siempre, sin valor por defecto").toBeNull();
  });

  it("los índices únicos y de consulta son los esperados, y los dos de nombre son sobre lower() (sin importar mayúsculas)", async () => {
    const indices = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; unico: boolean; definicion: string }>>`
      SELECT c.relname::text AS tabla, ic.relname::text AS nombre, i.indisunique AS unico, pg_get_indexdef(i.indexrelid) AS definicion
        FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
       WHERE c.relname IN ('PlanDeCostos', 'CentroDeCostos', 'PlanDeCostosSucursal') AND NOT i.indisprimary ORDER BY 1, 2`;
    expect(indices.map((i) => `${i.tabla}|${i.nombre}|${i.unico}`)).toEqual([
      "CentroDeCostos|CentroDeCostos_empresaId_codigo_key|true",
      "CentroDeCostos|CentroDeCostos_empresaId_id_key|true",
      "CentroDeCostos|CentroDeCostos_empresaId_planDeCostosId_id_key|true",
      "CentroDeCostos|CentroDeCostos_empresaId_planDeCostosId_nombre_key|true",
      "CentroDeCostos|CentroDeCostos_nombre_lower_key|true",
      "PlanDeCostos|PlanDeCostos_empresaId_codigo_key|true",
      "PlanDeCostos|PlanDeCostos_empresaId_id_key|true",
      "PlanDeCostos|PlanDeCostos_empresaId_nombre_key|true",
      "PlanDeCostos|PlanDeCostos_nombre_lower_key|true",
      "PlanDeCostosSucursal|PlanDeCostosSucursal_empresaId_id_key|true",
      "PlanDeCostosSucursal|PlanDeCostosSucursal_planDeCostosId_sucursalId_key|true",
      "PlanDeCostosSucursal|PlanDeCostosSucursal_sucursalId_idx|false",
    ]);
    const definicion = (n: string) => indices.find((i) => i.nombre === n)!.definicion;
    expect(definicion("PlanDeCostos_nombre_lower_key")).toMatch(/\("empresaId", lower\(nombre\)\)/);
    expect(definicion("CentroDeCostos_nombre_lower_key")).toMatch(/\("empresaId", "planDeCostosId", lower\(nombre\)\)/);
    expect(definicion("CentroDeCostos_empresaId_planDeCostosId_id_key"), "destino de las claves foráneas de tres columnas").toMatch(/\("empresaId", "planDeCostosId", id\)/);
  });

  it("las claves foráneas son RESTRICT; la del padre del centro lleva el plan como discriminador (tres columnas) y ON UPDATE RESTRICT", async () => {
    const fks = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; definicion: string }>>`
      SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint
       WHERE conrelid IN ('"PlanDeCostos"'::regclass, '"CentroDeCostos"'::regclass, '"PlanDeCostosSucursal"'::regclass) AND contype = 'f' ORDER BY 1, 2`;
    expect(fks.map((f) => f.nombre).sort()).toEqual(
      [
        FK_PADRE, "CentroDeCostos_empresaId_fkey", "CentroDeCostos_empresaId_planDeCostosId_fkey", "PlanDeCostos_empresaId_fkey",
        "PlanDeCostosSucursal_empresaId_fkey", "PlanDeCostosSucursal_empresaId_planDeCostosId_fkey", "PlanDeCostosSucursal_empresaId_sucursalId_fkey",
      ].sort(),
    );
    for (const f of fks) expect(f.definicion, f.nombre).toMatch(/ON DELETE RESTRICT/);
    const def = (n: string) => fks.find((f) => f.nombre === n)!.definicion;
    expect(def(FK_PADRE)).toBe('FOREIGN KEY ("empresaId", "planDeCostosId", "centroPadreId") REFERENCES "CentroDeCostos"("empresaId", "planDeCostosId", id) ON UPDATE RESTRICT ON DELETE RESTRICT');
    expect(def("CentroDeCostos_empresaId_planDeCostosId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "planDeCostosId"\) REFERENCES "PlanDeCostos"\("empresaId", id\)/);
    expect(def("PlanDeCostosSucursal_empresaId_planDeCostosId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "planDeCostosId"\) REFERENCES "PlanDeCostos"\("empresaId", id\)/);
    expect(def("PlanDeCostosSucursal_empresaId_sucursalId_fkey")).toMatch(/FOREIGN KEY \("empresaId", "sucursalId"\) REFERENCES "Sucursal"\("empresaId", id\)/);
  });

  it("los CHECK están puestos y validados (código y nombre de plan y de centro, y el centro sin padre)", async () => {
    const checks = await prismaAdmin.$queryRaw<Array<{ nombre: string; validada: boolean }>>`
      SELECT conname::text AS nombre, convalidated AS validada FROM pg_constraint
       WHERE conrelid IN ('"PlanDeCostos"'::regclass, '"CentroDeCostos"'::regclass, '"PlanDeCostosSucursal"'::regclass) AND contype = 'c' ORDER BY 1`;
    expect(checks).toEqual([
      { nombre: "CentroDeCostos_codigo_chk", validada: true },
      { nombre: "CentroDeCostos_nombre_chk", validada: true },
      { nombre: "CentroDeCostos_sin_padre_chk", validada: true },
      { nombre: "PlanDeCostos_codigo_chk", validada: true },
      { nombre: "PlanDeCostos_nombre_chk", validada: true },
    ]);
  });

  it("la RLS por empresa está puesta, sin FORCE, y `aislamiento_empresa` es la política de empresa de las tres (la aplicabilidad suma las 4 de sucursal de M7.3)", async () => {
    const rls = await prismaAdmin.$queryRaw<Array<{ tabla: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relname::text AS tabla, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid IN ('"PlanDeCostos"'::regclass, '"CentroDeCostos"'::regclass, '"PlanDeCostosSucursal"'::regclass) ORDER BY 1`;
    expect(rls).toEqual(["CentroDeCostos", "PlanDeCostos", "PlanDeCostosSucursal"].map((tabla) => ({ tabla, relrowsecurity: true, relforcerowsecurity: false })));
    const politicas = await prismaAdmin.$queryRaw<Array<{ tabla: string; nombre: string; qual: string; with_check: string }>>`
      SELECT tablename::text AS tabla, policyname::text AS nombre, qual, with_check FROM pg_policies WHERE tablename IN ('PlanDeCostos', 'CentroDeCostos') ORDER BY 1, 2`;
    expect(politicas.map((p) => `${p.tabla}|${p.nombre}`)).toEqual(["CentroDeCostos|aislamiento_empresa", "PlanDeCostos|aislamiento_empresa"]);
    expect(politicas.every((p) => /app_empresa_actual/.test(p.qual) && /app_empresa_actual/.test(p.with_check))).toBe(true);
    const deAplicabilidad = await prismaAdmin.$queryRaw<Array<{ nombre: string }>>`SELECT policyname::text AS nombre FROM pg_policies WHERE tablename = 'PlanDeCostosSucursal' ORDER BY 1`;
    expect(deAplicabilidad.map((p) => p.nombre)).toEqual(["aislamiento_empresa", "alcance_sucursal_delete", "alcance_sucursal_insert", "alcance_sucursal_select", "alcance_sucursal_update"]);
  });

  it("privilegios EXACTOS: motor2_app tiene SELECT e INSERT en las tres; UPDATE solo de `nombre` y `activo` (plan y centro) y de `aplica`; ningún DELETE; motor2_plataforma, nada", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const filas = await prismaAdmin.$queryRaw<Array<{ tabla: string; rol: string; privilegio: string }>>`
      SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name IN ('PlanDeCostos', 'CentroDeCostos', 'PlanDeCostosSucursal') AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`;
    expect(filas.map((f) => `${f.tabla}|${f.rol}|${f.privilegio}`).sort()).toEqual(TABLAS.flatMap((t) => ["INSERT", "SELECT"].map((p) => `${t}|motor2_app|${p}`)).sort());
    const actualizables = async (tabla: string) =>
      (await prismaAdmin.$queryRawUnsafe<Array<{ columna: string }>>(
        `SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"${tabla}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`,
      )).map((c) => c.columna);
    expect(await actualizables("PlanDeCostos")).toEqual(["activo", "nombre"]);
    expect(await actualizables("CentroDeCostos")).toEqual(["activo", "nombre"]);
    expect(await actualizables("PlanDeCostosSucursal")).toEqual(["aplica"]);
  });

  it("el migration.sql y el down.sql avisan que requieren autorización y que la reversa aborta con filas, y no se disfrazan de migración de políticas de sucursal", () => {
    const subida = readFileSync(join(CARPETA, "migration.sql"), "utf8");
    expect(subida.split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    const reversa = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(reversa).toMatch(/ABORTA/);
    for (const t of TABLAS) expect(reversa).toContain(`DROP TABLE IF EXISTS "${t}"`);
    for (const sql of [subida, reversa]) {
      expect(sql).not.toContain("alcance_sucursal_");
      expect(sql).not.toContain("app_sucursales_");
    }
  });
});

describe("las reglas del catálogo (plan y centro)", () => {
  it("el código exige mayúsculas, dígitos y guion bajo, letra inicial y hasta 40: minúscula, vacío, con guion medio, empezando con dígito o de 41 caracteres dan 23514; 40 entra", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    for (const malo of ["plan_x", "", "PLAN-X", "1PLAN", "_PLAN", "PLAN X", "A".repeat(41)]) {
      expect(await probar(app, plan({ codigo: malo })), `plan ${JSON.stringify(malo)}`).toEqual({ codigo: "23514", restriccion: "PlanDeCostos_codigo_chk" });
      expect(await probar(app, centro({ codigo: malo })), `centro ${JSON.stringify(malo)}`).toEqual({ codigo: "23514", restriccion: "CentroDeCostos_codigo_chk" });
    }
    const p40 = plan({ codigo: "A".repeat(40) });
    expect(await probar(app, p40)).toBeNull();
    const c40 = centro({ codigo: "B".repeat(40) });
    expect(await probar(app, c40)).toBeNull();
    expect(await cuantos("PlanDeCostos")).toBe(3);
  });

  it("el nombre exige un carácter visible y hasta 120: vacío, blancos, tabulador y 121 dan 23514; 120 entra; NULL da 23502", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    for (const malo of ["", "   ", "\t\n", "x".repeat(121)]) {
      const p = plan({ nombre: malo });
      expect(await probar(app, p), `plan ${malo.length}`).toEqual({ codigo: "23514", restriccion: "PlanDeCostos_nombre_chk" });
      const c = centro({ nombre: malo });
      expect(await probar(app, c), `centro ${malo.length}`).toEqual({ codigo: "23514", restriccion: "CentroDeCostos_nombre_chk" });
    }
    const sinNombre = plan({ nombre: null });
    expect(await probar(app, sinNombre)).toMatchObject({ codigo: "23502" });
    const justo = plan({ nombre: "x".repeat(120) });
    expect(await probar(app, justo)).toBeNull();
  });

  it("el código se repite por empresa (23505) en el plan y en el centro, aunque el centro sea de OTRO plan", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    const p = plan({ codigo: "PLAN_UN" });
    expect(await probar(app, p)).toEqual({ codigo: "23505", restriccion: "PlanDeCostos_empresaId_codigo_key" });
    const c = centro({ codigo: "UN_A", planDeCostosId: e.planOtroId });
    expect(await probar(app, c)).toEqual({ codigo: "23505", restriccion: "CentroDeCostos_empresaId_codigo_key" });
  });

  it("el nombre se repite sin importar mayúsculas (23505): por empresa en el plan, por plan en el centro; el mismo nombre en OTRO plan sí entra", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    const p = plan({ nombre: "UNIDADES DE NEGOCIO" });
    expect(await probar(app, p)).toEqual({ codigo: "23505", restriccion: "PlanDeCostos_nombre_lower_key" });
    const c = centro({ nombre: "unidad a" });
    expect(await probar(app, c)).toEqual({ codigo: "23505", restriccion: "CentroDeCostos_nombre_lower_key" });
    const exacto = centro({ nombre: "Unidad A", codigo: "UN_X" });
    expect(await probar(app, exacto)).toEqual({ codigo: "23505", restriccion: "CentroDeCostos_empresaId_planDeCostosId_nombre_key" });
    const enOtroPlan = centro({ nombre: "UNIDAD A", codigo: "UN_Y", planDeCostosId: e.planOtroId });
    expect(await probar(app, enOtroPlan)).toBeNull();
  });

  it("un centro con `centroPadreId` da 23514 en la v1 (aunque el padre exista y sea del mismo plan); sin padre entra", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    const hijo = centro({ centroPadreId: e.centroUnAId });
    expect(await probar(app, hijo)).toEqual({ codigo: "23514", restriccion: "CentroDeCostos_sin_padre_chk" });
    const huerfano = centro({ centroPadreId: "no-existe" });
    expect(await probar(app, huerfano)).toEqual({ codigo: "23514", restriccion: "CentroDeCostos_sin_padre_chk" });
    const raiz = centro();
    expect(await probar(app, raiz)).toBeNull();
  });

  it("la aplicabilidad es una por (plan, sucursal): repetirla da 23505, aun con otro `aplica`; `aplica` es obligatorio (23502)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp(undefined, { lectura: [e.sucursalA], escritura: [e.sucursalA] }); // la aplicabilidad es PROPIA: se escribe con la sucursal en el alcance
    const repetida = aplicabilidad({ aplica: false });
    expect(await probar(app, repetida)).toEqual({ codigo: "23505", restriccion: "PlanDeCostosSucursal_planDeCostosId_sucursalId_key" });
    await prismaAdmin.planDeCostosSucursal.deleteMany({ where: { sucursalId: e.sucursalA, planDeCostosId: e.planId } });
    expect(await probar(app, aplicabilidad({ aplica: null }))).toMatchObject({ codigo: "23502" });
    expect(await probar(app, aplicabilidad({ aplica: false }))).toBeNull();
  });
});

describe("la pertenencia: claves foráneas compuestas con empresaId", () => {
  it("un centro o una aplicabilidad con el plan de OTRA empresa dan 23503, aun escribiendo como DUEÑO con el empresaId explícito", async () => {
    const ajeno = await sembrarAjeno(e.usuarioId);
    const planAjeno = await ajeno.testigo.planDeCostos.create({ data: { codigo: "PLAN_T", nombre: "Plan testigo" } });
    const duenio = await conexionDelDuenio();
    const c = centro({ empresaId: EMPRESA_DE_PRUEBA_ID, planDeCostosId: planAjeno.id });
    expect(await probar(duenio, c)).toEqual({ codigo: "23503", restriccion: "CentroDeCostos_empresaId_planDeCostosId_fkey" });
    const a = aplicabilidad({ empresaId: EMPRESA_DE_PRUEBA_ID, planDeCostosId: planAjeno.id });
    expect(await probar(duenio, a)).toEqual({ codigo: "23503", restriccion: "PlanDeCostosSucursal_empresaId_planDeCostosId_fkey" });
    const sucursalAjena = aplicabilidad({ empresaId: EMPRESA_DE_PRUEBA_ID, sucursalId: ajeno.sucursal.id });
    expect(await probar(duenio, sucursalAjena)).toEqual({ codigo: "23503", restriccion: "PlanDeCostosSucursal_empresaId_sucursalId_fkey" });
    const propio = centro({ empresaId: EMPRESA_TESTIGO_ID, planDeCostosId: planAjeno.id });
    expect(await probar(duenio, propio)).toBeNull();
  });

  it("un plan con centros y con aplicabilidad, y una sucursal con aplicabilidad, no se pueden borrar (RESTRICT), ni como dueño", async () => {
    const duenio = await conexionDelDuenio();
    expect(await intentar(duenio, `DELETE FROM "PlanDeCostos" WHERE "id" = $1`, [e.planId])).toMatchObject({ codigo: "23503" });
    expect(await intentar(duenio, `DELETE FROM "Sucursal" WHERE "id" = $1`, [e.sucursalA])).toMatchObject({ codigo: "23503" });
    expect(await cuantos("PlanDeCostos")).toBe(2);
  });
});

describe("solo cambian `nombre`, `activo` y `aplica`: la app no modifica el resto ni borra nada", () => {
  it("como motor2_app, UPDATE de `codigo`, `planDeCostosId`, `sucursalId`, `centroPadreId` o `empresaId` da 42501; UPDATE de `nombre`, `activo` y `aplica` anda", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp(undefined, { lectura: [e.sucursalA], escritura: [e.sucursalA] }); // la aplicabilidad es PROPIA: se actualiza con la sucursal en el alcance de escritura
    const prohibidas: Array<[string, string, string, string]> = [
      ["PlanDeCostos", e.planId, "codigo", "'OTRO'"],
      ["PlanDeCostos", e.planId, "empresaId", `'${EMPRESA_TESTIGO_ID}'`],
      ["PlanDeCostos", e.planId, "creadoEn", "now()"],
      ["CentroDeCostos", e.centroUnAId, "codigo", "'OTRO'"],
      ["CentroDeCostos", e.centroUnAId, "planDeCostosId", `'${e.planOtroId}'`],
      ["CentroDeCostos", e.centroUnAId, "centroPadreId", `'${e.centroUnBId}'`],
    ];
    for (const [tabla, id, columna, valor] of prohibidas) {
      expect(await intentar(app, `UPDATE "${tabla}" SET "${columna}" = ${valor} WHERE "id" = $1`, [id]), `${tabla}.${columna}`).toMatchObject({ codigo: "42501" });
    }
    const aplic = await prismaAdmin.planDeCostosSucursal.findFirstOrThrow({ where: { planDeCostosId: e.planId, sucursalId: e.sucursalA } });
    for (const [columna, valor] of [["sucursalId", `'${e.sucursalB}'`], ["planDeCostosId", `'${e.planOtroId}'`]] as const) {
      expect(await intentar(app, `UPDATE "PlanDeCostosSucursal" SET "${columna}" = ${valor} WHERE "id" = $1`, [aplic.id]), `aplicabilidad.${columna}`).toMatchObject({ codigo: "42501" });
    }
    expect(await intentar(app, `UPDATE "PlanDeCostos" SET "nombre" = 'Nombre nuevo', "activo" = false WHERE "id" = $1`, [e.planId])).toBeNull();
    expect(await intentar(app, `UPDATE "CentroDeCostos" SET "nombre" = 'Otra unidad', "activo" = false WHERE "id" = $1`, [e.centroUnAId])).toBeNull();
    expect(await intentar(app, `UPDATE "PlanDeCostosSucursal" SET "aplica" = false WHERE "id" = $1`, [aplic.id])).toBeNull();
    const plan1 = await prismaAdmin.planDeCostos.findUniqueOrThrow({ where: { id: e.planId } });
    expect([plan1.codigo, plan1.nombre, plan1.activo]).toEqual(["PLAN_UN", "Nombre nuevo", false]);
    expect((await prismaAdmin.planDeCostosSucursal.findUniqueOrThrow({ where: { id: aplic.id } })).aplica).toBe(false);
  });

  it("DELETE y TRUNCATE de plan, centro y aplicabilidad dan 42501 y las filas quedan", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const app = await conexionComoApp();
    for (const tabla of TABLAS) {
      expect(await intentar(app, `DELETE FROM "${tabla}"`), `DELETE ${tabla}`).toMatchObject({ codigo: "42501" });
      expect(await intentar(app, `TRUNCATE "${tabla}"`), `TRUNCATE ${tabla}`).toMatchObject({ codigo: "42501" });
    }
    expect([await cuantos("PlanDeCostos"), await cuantos("CentroDeCostos"), await cuantos("PlanDeCostosSucursal")]).toEqual([2, 3, 4]);
  });

  it("la baja es desactivar: un plan y un centro inactivos siguen existiendo y se leen", async () => {
    await prisma.planDeCostos.update({ where: { id: e.planId }, data: { activo: false } });
    await prisma.centroDeCostos.update({ where: { id: e.centroUnAId }, data: { activo: false } });
    expect((await prisma.planDeCostos.findMany({ where: { activo: false } })).map((p) => p.id)).toEqual([e.planId]);
    expect((await prisma.centroDeCostos.findMany({ where: { activo: false } })).map((c) => c.id)).toEqual([e.centroUnAId]);
  });
});
