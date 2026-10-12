import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPRESA_DE_PRUEBA_ID, EMPRESA_TESTIGO_ID } from "../setup/empresa-de-prueba";
import { cerrarConexiones, conexionComoApp, esperarBloqueo, intentar, pidDe, TIPOS_DE_COSTO } from "../setup/gasto";
import { limpiarBaseDeTest, prismaAdmin } from "../setup/test-db";

/**
 * Paquete 3, M4.1 — migración 20261016110000_concepto_de_gasto: el catálogo de CONCEPTOS DE GASTO de la empresa, contra la base real y con conexiones reales como `motor2_app` (el rol de la app, sujeto a la RLS).
 *
 * Qué se mide: el formato del código y del nombre; los CINCO tipos de costo (D2: el quinto es RESULTADO_FINANCIERO, «descuento obtenido»); la unicidad por empresa del código y del nombre (sin importar mayúsculas), que la decide la BASE
 * (dos altas simultáneas del mismo concepto → exactamente una gana y la otra recibe 23505; el segundo INSERT ESPERA al primero); el aislamiento entre empresas (B no ve los conceptos de A y no puede escribir en A);
 * y los privilegios: SELECT e INSERT, UPDATE solo de `nombre`, `tipoDeCostoPorDefecto` y `activo` (el código es fijo) y NUNCA DELETE.
 *
 * Mutaciones demostradas (ver el informe del paso): sacar `codigo` de la lista de columnas sin UPDATE (o dárselo), sacar `RESULTADO_FINANCIERO` del CHECK, sacar el índice `lower("nombre")` o el único del código, o sacar el `WITH CHECK`
 * de la política de empresa dejan en rojo, cada una, su test.
 */
afterAll(() => prismaAdmin.$disconnect());

const CARPETA = join(__dirname, "../../prisma/migrations/20261016110000_concepto_de_gasto");
const UNICOS = ["ConceptoDeGasto_empresaId_codigo_key", "ConceptoDeGasto_empresaId_id_key", "ConceptoDeGasto_empresaId_nombre_key", "ConceptoDeGasto_nombre_lower_key"];

const hayRol = async (rol: string) => ((await prismaAdmin.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${rol}`)[0]!.n) === BigInt(1);

beforeEach(async () => {
  await limpiarBaseDeTest();
});
afterEach(cerrarConexiones);

/** Un concepto válido con el `empresaId` de la conexión. */
const insertar = (codigo: string, nombre = `Concepto ${codigo}`, tipo = "GASTO_OPERATIVO", id = randomUUID()) =>
  ({ texto: `INSERT INTO "ConceptoDeGasto" ("id","codigo","nombre","tipoDeCostoPorDefecto") VALUES ($1,$2,$3,$4) RETURNING "id"`, params: [id, codigo, nombre, tipo] });

/** Alta con transacción propia: el id, o el error de Postgres. */
async function alta(c: Awaited<ReturnType<typeof conexionComoApp>>, codigo: string, nombre?: string, tipo?: string) {
  const { texto, params } = insertar(codigo, nombre, tipo);
  return intentar(c, texto, params);
}

const cuantos = async (filtro = "TRUE") => Number((await prismaAdmin.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "ConceptoDeGasto" WHERE ${filtro}`))[0]!.n);

describe("la migración deja la tabla, los índices, las reglas, la RLS y los privilegios puestos", () => {
  it("tiene las columnas esperadas, con su tipo y su nulabilidad, en este orden", async () => {
    const columnas = await prismaAdmin.$queryRaw<Array<{ columna: string; tipo: string; es_nulable: string; por_defecto: string | null }>>`
      SELECT column_name::text AS columna, data_type AS tipo, is_nullable AS es_nulable, column_default AS por_defecto
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ConceptoDeGasto' ORDER BY ordinal_position`;
    expect(columnas.map((c) => `${c.columna}:${c.tipo}:${c.es_nulable}`)).toEqual([
      "id:text:NO", "empresaId:text:NO", "codigo:text:NO", "nombre:text:NO", "tipoDeCostoPorDefecto:text:NO", "activo:boolean:NO", "creadoEn:timestamp without time zone:NO",
    ]);
    expect(columnas.find((c) => c.columna === "empresaId")!.por_defecto).toMatch(/app_empresa_actual\(\)/);
    expect(columnas.find((c) => c.columna === "activo")!.por_defecto).toBe("true");
  });

  it("los cuatro índices únicos están puestos, y el del nombre es sobre lower(nombre) por empresa", async () => {
    const unicos = await prismaAdmin.$queryRaw<Array<{ nombre: string; definicion: string }>>`
      SELECT ic.relname::text AS nombre, pg_get_indexdef(i.indexrelid) AS definicion FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_class ic ON ic.oid = i.indexrelid
      WHERE c.relname = 'ConceptoDeGasto' AND i.indisunique AND NOT i.indisprimary ORDER BY 1`;
    expect(unicos.map((u) => u.nombre)).toEqual(UNICOS);
    expect(unicos.find((u) => u.nombre === "ConceptoDeGasto_nombre_lower_key")!.definicion).toMatch(/\("empresaId", lower\(nombre\)\)/);
  });

  it("los tres CHECK están puestos y validados, y la clave foránea a la empresa también", async () => {
    const filas = await prismaAdmin.$queryRaw<Array<{ nombre: string; tipo: string; validada: boolean }>>`
      SELECT conname::text AS nombre, contype::text AS tipo, convalidated AS validada FROM pg_constraint WHERE conrelid = '"ConceptoDeGasto"'::regclass AND contype IN ('c', 'f') ORDER BY 1`;
    expect(filas.map((f) => f.nombre)).toEqual(["ConceptoDeGasto_codigo_chk", "ConceptoDeGasto_empresaId_fkey", "ConceptoDeGasto_nombre_chk", "ConceptoDeGasto_tipo_de_costo_chk"]);
    expect(filas.every((f) => f.validada)).toBe(true);
  });

  it("el CHECK del tipo de costo lista EXACTAMENTE los cinco valores de D2 (el quinto, RESULTADO_FINANCIERO, desde M4)", async () => {
    const [{ definicion }] = await prismaAdmin.$queryRaw<Array<{ definicion: string }>>`SELECT pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conname = 'ConceptoDeGasto_tipo_de_costo_chk'`;
    const valores = [...definicion.matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]!).sort();
    expect(valores).toEqual([...TIPOS_DE_COSTO].sort());
  });

  it("la RLS por empresa está puesta (una política aislamiento_empresa con USING y WITH CHECK) y sin FORCE; NO tiene políticas de sucursal", async () => {
    const rls = await prismaAdmin.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = '"ConceptoDeGasto"'::regclass`;
    expect(rls).toEqual([{ relrowsecurity: true, relforcerowsecurity: false }]);
    const politicas = await prismaAdmin.$queryRaw<Array<{ nombre: string; qual: string | null; with_check: string | null }>>`SELECT policyname::text AS nombre, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ConceptoDeGasto'`;
    expect(politicas.map((p) => p.nombre)).toEqual(["aislamiento_empresa"]);
    expect(politicas[0]!.qual).toMatch(/app_empresa_actual/);
    expect(politicas[0]!.with_check).toMatch(/app_empresa_actual/);
  });

  it("motor2_app tiene SELECT e INSERT y UPDATE SOLO de nombre, tipoDeCostoPorDefecto y activo (el código es fijo); nunca DELETE; motor2_plataforma no tiene nada", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const filas = await prismaAdmin.$queryRaw<Array<{ rol: string; privilegio: string }>>`
      SELECT grantee::text AS rol, privilege_type AS privilegio FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'ConceptoDeGasto' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`;
    expect(filas.map((f) => `${f.rol}|${f.privilegio}`)).toEqual(["motor2_app|INSERT", "motor2_app|SELECT"]);
    const columnas = await prismaAdmin.$queryRaw<Array<{ columna: string }>>`
      SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"ConceptoDeGasto"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`;
    expect(columnas.map((c) => c.columna)).toEqual(["activo", "nombre", "tipoDeCostoPorDefecto"]);
    const plataforma = await prismaAdmin.$queryRaw<Array<{ puede: boolean }>>`SELECT has_table_privilege('motor2_plataforma', '"ConceptoDeGasto"', 'SELECT') AS puede`;
    if (await hayRol("motor2_plataforma")) expect(plataforma[0]!.puede).toBe(false);
  });

  it("el migration.sql y el down.sql avisan que requieren autorización y que la reversa puede perder datos", () => {
    expect(readFileSync(join(CARPETA, "migration.sql"), "utf8").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    const reversa = readFileSync(join(CARPETA, "down.sql"), "utf8");
    expect(reversa).toMatch(/DESTRUCTIVA/);
    expect(reversa).toMatch(/ANTES M4\.2/);
    expect(reversa).toContain('DROP TABLE IF EXISTS "ConceptoDeGasto"');
  });
});

describe("las reglas del concepto (como motor2_app)", () => {
  it("el código tiene el formato: mayúsculas, dígitos y guion bajo, empieza con letra, hasta 40", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const c = await conexionComoApp();
    for (const bueno of ["ALQUILER", "A", "LUZ_2", "A".repeat(40), "X_9"]) expect(await alta(c, bueno), bueno).toBeNull();
    for (const malo of ["alquiler", "1LUZ", "_LUZ", "LUZ-2", "LUZ 2", "LUZ.2", "", "A".repeat(41), "ÁLQUILER"]) {
      expect(await alta(c, malo, `Malo ${malo}`), JSON.stringify(malo)).toEqual({ codigo: "23514", restriccion: "ConceptoDeGasto_codigo_chk" });
    }
  });

  it("el nombre no puede quedar vacío ni pasar de 120 caracteres", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const c = await conexionComoApp();
    for (const malo of ["", "   ", "\t\n", "x".repeat(121)]) expect(await alta(c, "NOMBRE_MALO", malo), JSON.stringify(malo)).toEqual({ codigo: "23514", restriccion: "ConceptoDeGasto_nombre_chk" });
    expect(await alta(c, "NOMBRE_120", "x".repeat(120))).toBeNull();
  });

  it("acepta los CINCO tipos de costo (D2) y rechaza cualquier otro, incluido uno en minúsculas o vacío", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const c = await conexionComoApp();
    for (const tipo of TIPOS_DE_COSTO) expect(await alta(c, `T_${tipo}`, `Tipo ${tipo}`, tipo), tipo).toBeNull();
    expect(await cuantos()).toBe(5);
    for (const malo of ["RUBRO", "gasto_operativo", "", "COSTO", "RESULTADO FINANCIERO"]) {
      expect(await alta(c, "T_MALO", `Malo ${malo}`, malo), JSON.stringify(malo)).toEqual({ codigo: "23514", restriccion: "ConceptoDeGasto_tipo_de_costo_chk" });
    }
  });

  it("activo arranca en true, y creadoEn y empresaId salen solos (la empresa, del contexto de la conexión)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const c = await conexionComoApp();
    expect(await alta(c, "ALQUILER", "Alquiler")).toBeNull();
    const [f] = await prismaAdmin.$queryRaw<Array<{ activo: boolean; empresaId: string; creadoEn: Date }>>`SELECT "activo", "empresaId", "creadoEn" FROM "ConceptoDeGasto" WHERE "codigo" = 'ALQUILER'`;
    expect(f!.activo).toBe(true);
    expect(f!.empresaId).toBe(EMPRESA_DE_PRUEBA_ID);
    expect(f!.creadoEn).toBeInstanceOf(Date);
  });

  it("el código y el nombre son únicos por empresa; el nombre sin importar mayúsculas; el MISMO código y nombre en OTRA empresa están permitidos", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const a = await conexionComoApp();
    const b = await conexionComoApp(EMPRESA_TESTIGO_ID);
    expect(await alta(a, "ALQUILER", "Alquiler")).toBeNull();
    expect(await alta(a, "ALQUILER", "Otro nombre")).toEqual({ codigo: "23505", restriccion: "ConceptoDeGasto_empresaId_codigo_key" });
    expect(await alta(a, "ALQUILER_2", "Alquiler")).toEqual({ codigo: "23505", restriccion: "ConceptoDeGasto_empresaId_nombre_key" });
    expect(await alta(a, "ALQUILER_3", "ALQUILER")).toEqual({ codigo: "23505", restriccion: "ConceptoDeGasto_nombre_lower_key" });
    expect(await alta(a, "ALQUILER_4", "alquiler")).toEqual({ codigo: "23505", restriccion: "ConceptoDeGasto_nombre_lower_key" });
    expect(await alta(b, "ALQUILER", "Alquiler")).toBeNull();
    expect(await cuantos(`"empresaId" = '${EMPRESA_DE_PRUEBA_ID}'`)).toBe(1);
    expect(await cuantos(`"empresaId" = '${EMPRESA_TESTIGO_ID}'`)).toBe(1);
  });
});

describe("dos altas simultáneas del mismo concepto: gana una (la unicidad la decide la base)", () => {
  it("dos clientes a la vez con el mismo código: exactamente una confirma y la otra recibe 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await Promise.all([conexionComoApp(), conexionComoApp()]);
    const resultados = await Promise.all([alta(a, "ALQUILER", "Alquiler del local"), alta(b, "ALQUILER", "Alquiler del depósito")]);
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r !== null)).toEqual([{ codigo: "23505", restriccion: "ConceptoDeGasto_empresaId_codigo_key" }]);
    expect(await cuantos()).toBe(1);
  });

  it("ocho clientes a la vez con el mismo nombre (en mayúsculas distintas y con códigos distintos): uno solo queda guardado y los otros siete reciben 23505 sobre el nombre", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const clientes = await Promise.all(Array.from({ length: 8 }, () => conexionComoApp()));
    const nombres = ["Luz", "LUZ", "luz", "lUz", "Luz", "LUZ", "luz", "lUZ"];
    const resultados = await Promise.all(clientes.map((c, i) => alta(c, `LUZ_${i}`, nombres[i])));
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r !== null && r.codigo === "23505" && r.restriccion.startsWith("ConceptoDeGasto_"))).toHaveLength(7);
    expect(await cuantos()).toBe(1);
  });

  it("el segundo INSERT ESPERA al primero (no lo adivina): si la primera transacción hace ROLLBACK, la segunda entra; si CONFIRMA, recibe 23505", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await Promise.all([conexionComoApp(), conexionComoApp()]);
    const sentencia = insertar("FLETE", "Flete");
    // 1) La primera hace ROLLBACK: la segunda, que esperaba, entra.
    await a.query("BEGIN");
    await a.query(sentencia.texto, sentencia.params);
    await b.query("BEGIN");
    const pidDeB = await pidDe(b);
    const otra = insertar("FLETE", "Flete");
    const segundo = b.query(otra.texto, otra.params);
    await esperarBloqueo(pidDeB);
    await a.query("ROLLBACK");
    expect((await segundo).rows).toHaveLength(1);
    await b.query("COMMIT");
    expect(await cuantos()).toBe(1);
    // 2) La primera CONFIRMA: la segunda, que esperaba, recibe 23505.
    await a.query("BEGIN");
    const nueva = insertar("HONORARIOS", "Honorarios");
    await a.query(nueva.texto, nueva.params);
    await b.query("BEGIN");
    const repetida = insertar("HONORARIOS", "Honorarios");
    const tercero = b.query(repetida.texto, repetida.params).then(() => "entró" as const, (error: { code?: string; constraint?: string }) => `${error.code}|${error.constraint}`);
    await esperarBloqueo(pidDeB);
    await a.query("COMMIT");
    expect(await tercero).toBe("23505|ConceptoDeGasto_empresaId_codigo_key");
    await b.query("ROLLBACK");
    expect(await cuantos()).toBe(2);
  });

  it("repetir la misma alta (reintento de la pantalla) no duplica: 23505 y la cuenta sigue en 1", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const a = await conexionComoApp();
    expect(await alta(a, "ALQUILER", "Alquiler")).toBeNull();
    expect(await alta(a, "ALQUILER", "Alquiler")).toMatchObject({ codigo: "23505" });
    expect(await alta(a, "ALQUILER", "Alquiler")).toMatchObject({ codigo: "23505" });
    expect(await cuantos()).toBe(1);
  });

  it("dos renombres simultáneos de conceptos distintos al MISMO nombre: gana uno y el otro recibe 23505 (el nombre sigue único)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await Promise.all([conexionComoApp(), conexionComoApp()]);
    expect(await alta(a, "UNO", "Uno")).toBeNull();
    expect(await alta(a, "DOS", "Dos")).toBeNull();
    const renombrar = (c: typeof a, codigo: string) => intentar(c, `UPDATE "ConceptoDeGasto" SET "nombre" = 'Servicios' WHERE "codigo" = $1`, [codigo]);
    const resultados = await Promise.all([renombrar(a, "UNO"), renombrar(b, "DOS")]);
    expect(resultados.filter((r) => r === null)).toHaveLength(1);
    expect(resultados.filter((r) => r !== null)).toEqual([{ codigo: "23505", restriccion: expect.stringMatching(/^ConceptoDeGasto_(empresaId_nombre|nombre_lower)_key$/) }]);
    expect(await cuantos(`"nombre" = 'Servicios'`)).toBe(1);
  });

  it("dos cambios simultáneos del tipo de costo por defecto con la guarda «solo si sigue siendo el que leí»: gana uno (1 fila) y el otro toca 0 filas; nadie pisa a nadie", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const [a, b] = await Promise.all([conexionComoApp(), conexionComoApp()]);
    expect(await alta(a, "ALQUILER", "Alquiler", "GASTO_OPERATIVO")).toBeNull();
    const cambiar = async (c: typeof a, nuevo: string) => {
      await c.query("BEGIN");
      const r = await c.query(`UPDATE "ConceptoDeGasto" SET "tipoDeCostoPorDefecto" = $1 WHERE "codigo" = 'ALQUILER' AND "tipoDeCostoPorDefecto" = 'GASTO_OPERATIVO'`, [nuevo]);
      await c.query("COMMIT");
      return r.rowCount;
    };
    const filas = await Promise.all([cambiar(a, "INVERSION"), cambiar(b, "EXTRAORDINARIO")]);
    expect([...filas].sort()).toEqual([0, 1]);
    const [{ tipo }] = await prismaAdmin.$queryRaw<Array<{ tipo: string }>>`SELECT "tipoDeCostoPorDefecto" AS tipo FROM "ConceptoDeGasto" WHERE "codigo" = 'ALQUILER'`;
    expect(["INVERSION", "EXTRAORDINARIO"]).toContain(tipo);
  });
});

describe("aislamiento entre empresas y privilegios (como motor2_app)", () => {
  it("la empresa B no ve los conceptos de A, y un INSERT con el empresaId de A desde B da 42501 (WITH CHECK de la RLS)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const a = await conexionComoApp();
    const b = await conexionComoApp(EMPRESA_TESTIGO_ID);
    expect(await alta(a, "ALQUILER", "Alquiler")).toBeNull();
    expect((await b.query(`SELECT 1 FROM "ConceptoDeGasto"`)).rowCount).toBe(0);
    expect((await a.query(`SELECT 1 FROM "ConceptoDeGasto"`)).rowCount).toBe(1);
    expect(await intentar(b, `INSERT INTO "ConceptoDeGasto" ("id","empresaId","codigo","nombre","tipoDeCostoPorDefecto") VALUES ($1,$2,'AJENO','Ajeno','GASTO_OPERATIVO')`, [randomUUID(), EMPRESA_DE_PRUEBA_ID]))
      .toMatchObject({ codigo: "42501" });
    // Y B no puede tocar el de A: ni verlo para modificarlo (0 filas) ni renombrarlo.
    const r = await b.query(`UPDATE "ConceptoDeGasto" SET "nombre" = 'Robado' WHERE "codigo" = 'ALQUILER'`);
    expect(r.rowCount).toBe(0);
    expect(await cuantos(`"nombre" = 'Alquiler'`)).toBe(1);
  });

  it("el código NO se puede cambiar (UPDATE de codigo da 42501), pero el nombre, el tipo y activo sí; DELETE da 42501", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const a = await conexionComoApp();
    expect(await alta(a, "ALQUILER", "Alquiler")).toBeNull();
    expect(await intentar(a, `UPDATE "ConceptoDeGasto" SET "codigo" = 'ALQUILER_NUEVO' WHERE "codigo" = 'ALQUILER'`)).toMatchObject({ codigo: "42501" });
    expect(await intentar(a, `UPDATE "ConceptoDeGasto" SET "empresaId" = 'empresa_testigo' WHERE "codigo" = 'ALQUILER'`)).toMatchObject({ codigo: "42501" });
    expect(await intentar(a, `UPDATE "ConceptoDeGasto" SET "creadoEn" = now() WHERE "codigo" = 'ALQUILER'`)).toMatchObject({ codigo: "42501" });
    expect(await intentar(a, `UPDATE "ConceptoDeGasto" SET "nombre" = 'Alquiler del local', "tipoDeCostoPorDefecto" = 'INVERSION', "activo" = false WHERE "codigo" = 'ALQUILER'`)).toBeNull();
    const [f] = await prismaAdmin.$queryRaw<Array<{ nombre: string; tipo: string; activo: boolean; codigo: string }>>`SELECT "nombre", "tipoDeCostoPorDefecto" AS tipo, "activo", "codigo" FROM "ConceptoDeGasto"`;
    expect(f).toEqual({ nombre: "Alquiler del local", tipo: "INVERSION", activo: false, codigo: "ALQUILER" });
    expect(await intentar(a, `DELETE FROM "ConceptoDeGasto" WHERE "codigo" = 'ALQUILER'`)).toMatchObject({ codigo: "42501" });
    expect(await intentar(a, `TRUNCATE "ConceptoDeGasto"`)).toMatchObject({ codigo: "42501" });
    expect(await cuantos()).toBe(1);
  });

  it("un cambio de tipo o de nombre inválido por UPDATE también se rechaza con el CHECK (el valor viejo queda)", async (ctx) => {
    if (!(await hayRol("motor2_app"))) return ctx.skip();
    const a = await conexionComoApp();
    expect(await alta(a, "ALQUILER", "Alquiler", "GASTO_OPERATIVO")).toBeNull();
    expect(await intentar(a, `UPDATE "ConceptoDeGasto" SET "tipoDeCostoPorDefecto" = 'RUBRO'`)).toEqual({ codigo: "23514", restriccion: "ConceptoDeGasto_tipo_de_costo_chk" });
    expect(await intentar(a, `UPDATE "ConceptoDeGasto" SET "nombre" = '  '`)).toEqual({ codigo: "23514", restriccion: "ConceptoDeGasto_nombre_chk" });
    expect(await cuantos(`"tipoDeCostoPorDefecto" = 'GASTO_OPERATIVO' AND "nombre" = 'Alquiler'`)).toBe(1);
  });
});
