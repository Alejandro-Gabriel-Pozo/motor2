import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Carta, familias de productos F1: las tablas `FamiliaDeProducto` y `MiembroDeFamilia` y los dos disparadores del invariante TRANSITORIO «familia o ítem agrupado» (migración 20261117161000). SUBIR, BAJAR y SUBIR sobre una base TEMPORAL
 * migrada como una real. Prueba: ANTES las tablas no existen; SUBIR las crea con sus únicos (el parcial por producto y el parcial por posición), sus CHECK, sus claves por empresa, su RLS por empresa y los privilegios de la app (leer, agregar,
 * cambiar solo las columnas con privilegio, NUNCA borrar); la base decide con SQL directo (un miembro quitado no cambia más, no se borra, un producto en dos familias, el cruce con el ítem agrupado aunque se saltee el caso de uso, también
 * con un ítem agrupado inactivo o de una sucursal que el alcance no deja ver); BAJAR CON FILAS aborta y no pierde nada; con las tablas vacías baja (y saca el disparador de `OpcionItemAgrupadoCarta`) y bajar dos veces no falla; SUBIR OTRA VEZ deja el
 * catálogo idéntico al de la primera subida. Contra Postgres local; nunca contra una base real.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261117161000_familias_de_producto";
const E = "empresa_fam";
const E2 = "empresa_fam_2";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const FAJENA = "00000000-0000-4000-8000-0000000000fa";
let contador = 0;
const nuevoUuid = () => `00000000-0000-4000-8000-${String(++contador).padStart(12, "0")}`;

let base: BaseTemporalMigrada;
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, MIGRACION, archivo), "utf8");
const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(leer(archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);
const existe = async (tabla: string) => (await q(`SELECT to_regclass($1)::text AS t`, [`public."${tabla}"`]))[0].t !== null;
/** El código SQLSTATE (y el mensaje) con que falla una sentencia, SIN dejar nada (se deshace). `sin error` si pasó. Con `rol`, como ese rol (la app), con la empresa fijada. */
const falla = async (texto: string, params: unknown[] = [], rol?: { rol: string; empresa: string; sucursales?: string[] }): Promise<string> => {
  await base.cliente.query("BEGIN");
  try {
    if (rol) {
      await base.cliente.query(`SET LOCAL ROLE ${rol.rol}`);
      await base.cliente.query(`SELECT set_config('app.empresa_id', $1, true), set_config('app.sucursales_escritura', $2, true)`, [rol.empresa, (rol.sucursales ?? []).join(",")]);
    }
    await base.cliente.query(texto, params);
    return "sin error";
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return `${err.code ?? ""} ${err.message ?? ""}`.trim();
  } finally {
    await base.cliente.query("ROLLBACK");
  }
};
const codigo = (r: string) => r.split(" ")[0];

const nuevaFamilia = (id: string, nombre: string, empresa = E, extra = "") =>
  q(`INSERT INTO "FamiliaDeProducto" ("id","empresaId","nombre","nombreClave","creadoPorId","actualizadoEn") VALUES ($1,$2,$3,lower($3),'u_fam',now())${extra}`, [id, empresa, nombre]);
const nuevoMiembro = (id: string, familia: string, producto: string, posicion: number, empresa = E) =>
  q(`INSERT INTO "MiembroDeFamilia" ("id","empresaId","familiaId","productoId","posicion","agregadoPorId","agregadoEn") VALUES ($1,$2,$3,$4,$5,'u_fam',now())`, [id, empresa, familia, producto, posicion]);
const SQL_MIEMBRO = `INSERT INTO "MiembroDeFamilia" ("id","empresaId","familiaId","productoId","posicion","agregadoPorId","agregadoEn") VALUES ($1,$2,$3,$4,$5,'u_fam',now())`;
const SQL_OPCION = `INSERT INTO "OpcionItemAgrupadoCarta" ("id","empresaId","sucursalId","itemAgrupadoCartaId","productoId") VALUES ($1,$2,$3,$4,$5)`;

async function foto() {
  const tablas = ["FamiliaDeProducto", "MiembroDeFamilia"];
  const porTabla = async (consulta: (t: string) => Promise<unknown>) => Object.fromEntries(await Promise.all(tablas.map(async (t) => [t, await consulta(t)])));
  return {
    columnas: await porTabla((t) => q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY 1`, [t])),
    restricciones: await porTabla((t) => q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = ('public."' || $1 || '"')::regclass ORDER BY 1`, [t])),
    indices: await porTabla((t) => q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 ORDER BY 1`, [t])),
    politicas: await porTabla((t) => q(`SELECT policyname::text AS nombre, cmd::text, permissive::text, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY 1`, [t])),
    privilegios: await porTabla((t) => q(`SELECT privilege_type::text AS p FROM information_schema.role_table_grants WHERE table_name = $1 AND grantee = 'motor2_app' ORDER BY 1`, [t])),
    columnasConUpdate: await porTabla((t) => q(`SELECT column_name::text AS c FROM information_schema.column_privileges WHERE table_name = $1 AND grantee = 'motor2_app' AND privilege_type = 'UPDATE' ORDER BY 1`, [t])),
    disparadores: await q(`SELECT tgname::text AS nombre, tgrelid::regclass::text AS tabla FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('FamiliaDeProducto_proteger','MiembroDeFamilia_proteger','MiembroDeFamilia_no_si_agrupado','OpcionItemAgrupadoCarta_no_si_en_familia') ORDER BY 1`),
    funciones: await q(`SELECT proname::text AS nombre, prosecdef AS definer, proconfig FROM pg_proc WHERE proname IN ('FamiliaDeProducto_proteger','MiembroDeFamilia_proteger','MiembroDeFamilia_no_si_agrupado','OpcionItemAgrupadoCarta_no_si_en_familia') ORDER BY 1`),
  };
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(MIGRACION);
  for (const e of [E, E2]) await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
  await q(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_fam',$1,'Centro'), ('suc_fam_2',$1,'Norte'), ('suc_fam_e2',$2,'Otra')`, [E, E2]);
  await q(`INSERT INTO "SeccionCarta" ("id","empresaId","nombre") VALUES ('sec_fam',$1,'Bebidas')`, [E]);
  await q(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud","decimales") VALUES ('uni_fam',$1,'u','CANTIDAD',0), ('uni_fam_e2',$2,'u','CANTIDAD',0)`, [E, E2]);
  for (const p of ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) await q(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId") VALUES ($1,$2,$1,$1,'PV','uni_fam')`, [p, E]);
  await q(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId") VALUES ('p_ajeno',$1,'p_ajeno','p_ajeno','PV','uni_fam_e2')`, [E2]);
  await q(`INSERT INTO "User" ("id","email") VALUES ('u_fam','fam@ejemplo.test')`);
  // Un ítem agrupado de la sucursal 2 (inactivo) y otro de la sucursal 1, con productos ya agrupados ANTES de la migración (las filas viejas no se revalidan).
  await q(`INSERT INTO "ItemAgrupadoCarta" ("id","empresaId","sucursalId","nombre","seccionCartaId","actualizadoEn","activo") VALUES ('item_fam',$1,'suc_fam','Gaseosa','sec_fam',now(),true), ('item_fam_inactivo',$1,'suc_fam_2','Agua','sec_fam',now(),false)`, [E]);
  await q(SQL_OPCION, ["opcion_vieja", E, "suc_fam", "item_fam", "p6"]);
}, 300_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("FamiliaDeProducto y MiembroDeFamilia (subir, bajar y subir)", () => {
  let primeraSubida: Awaited<ReturnType<typeof foto>>;

  it("ANTES: las tablas no existen", async () => {
    expect(await existe("FamiliaDeProducto")).toBe(false);
    expect(await existe("MiembroDeFamilia")).toBe(false);
  });

  it("SUBIR: las tablas nacen vacías con sus únicos (parciales incluidos), la RLS por empresa y los privilegios de la app (leer, agregar y cambiar SOLO algunas columnas; sin borrar); los dos disparadores del cruce son SECURITY DEFINER con search_path fijo", async () => {
    await correr("migration.sql");
    expect(await q(`SELECT (SELECT count(*) FROM "FamiliaDeProducto")::int AS f, (SELECT count(*) FROM "MiembroDeFamilia")::int AS m`)).toEqual([{ f: 0, m: 0 }]);
    const f = await foto();
    const nombresDe = (r: unknown) => (r as { nombre: string }[]).map((x) => x.nombre).sort();
    expect(nombresDe(f.indices.FamiliaDeProducto)).toEqual(["FamiliaDeProducto_empresaId_id_key", "FamiliaDeProducto_empresaId_nombreClave_key", "FamiliaDeProducto_pkey"].sort());
    expect(nombresDe(f.indices.MiembroDeFamilia)).toEqual(
      ["MiembroDeFamilia_empresaId_id_key", "MiembroDeFamilia_familiaId_idx", "MiembroDeFamilia_pkey", "MiembroDeFamilia_posicion_vigente_key", "MiembroDeFamilia_producto_vigente_key", "MiembroDeFamilia_productoId_idx"].sort(),
    );
    expect((f.indices.MiembroDeFamilia as { nombre: string; indexdef: string }[]).find((i) => i.nombre === "MiembroDeFamilia_producto_vigente_key")!.indexdef).toMatch(/UNIQUE.*\("empresaId", "productoId"\).*WHERE \("quitadoEn" IS NULL\)/);
    expect((f.indices.MiembroDeFamilia as { nombre: string; indexdef: string }[]).find((i) => i.nombre === "MiembroDeFamilia_posicion_vigente_key")!.indexdef).toMatch(/UNIQUE.*\("empresaId", "familiaId", posicion\).*WHERE \("quitadoEn" IS NULL\)/);
    expect(nombresDe(f.politicas.FamiliaDeProducto)).toEqual(["aislamiento_empresa"]);
    expect(nombresDe(f.politicas.MiembroDeFamilia)).toEqual(["aislamiento_empresa"]);
    expect(f.privilegios).toEqual({ FamiliaDeProducto: [{ p: "INSERT" }, { p: "SELECT" }], MiembroDeFamilia: [{ p: "INSERT" }, { p: "SELECT" }] });
    expect(f.columnasConUpdate.FamiliaDeProducto).toEqual(["activa", "actualizadoEn", "agruparEnCarta", "agruparEnPos", "nombre", "nombreClave", "version"].map((c) => ({ c })));
    expect(f.columnasConUpdate.MiembroDeFamilia).toEqual([{ c: "quitadoEn" }, { c: "quitadoPorId" }]);
    expect((f.columnas.FamiliaDeProducto as { columna: string; data_type: string }[]).find((c) => c.columna === "id")).toMatchObject({ data_type: "uuid" });
    expect((f.columnas.FamiliaDeProducto as { columna: string; column_default: string | null }[]).find((c) => c.columna === "actualizadoEn")).toMatchObject({ column_default: null });
    expect(f.columnas.FamiliaDeProducto).toEqual(expect.arrayContaining([expect.objectContaining({ columna: "agruparEnCarta", column_default: "false" }), expect.objectContaining({ columna: "agruparEnPos", column_default: "false" })]));
    expect(f.disparadores).toEqual([
      { nombre: "FamiliaDeProducto_proteger", tabla: '"FamiliaDeProducto"' },
      { nombre: "MiembroDeFamilia_no_si_agrupado", tabla: '"MiembroDeFamilia"' },
      { nombre: "MiembroDeFamilia_proteger", tabla: '"MiembroDeFamilia"' },
      { nombre: "OpcionItemAgrupadoCarta_no_si_en_familia", tabla: '"OpcionItemAgrupadoCarta"' },
    ]);
    const definer = (f.funciones as { nombre: string; definer: boolean; proconfig: string[] | null }[]).filter((x) => x.nombre.includes("no_si_"));
    expect(definer.map((x) => x.definer)).toEqual([true, true]);
    for (const x of f.funciones as { proconfig: string[] | null }[]) expect(x.proconfig?.some((c) => c.startsWith("search_path="))).toBe(true);
    primeraSubida = f;
  });

  it("la base decide la FAMILIA: nombre vacío o de más de 120 (23514), versión 0 (23514), el mismo nombre por empresa (23505) pero no entre empresas, un id que no es uuid (22P02)", async () => {
    expect(codigo(await falla(`INSERT INTO "FamiliaDeProducto" ("id","empresaId","nombre","nombreClave","creadoPorId","actualizadoEn") VALUES ($1,$2,'','x','u_fam',now())`, [F1, E]))).toBe("23514");
    expect(codigo(await falla(`INSERT INTO "FamiliaDeProducto" ("id","empresaId","nombre","nombreClave","creadoPorId","actualizadoEn") VALUES ($1,$2,$3,'x','u_fam',now())`, [F1, E, "a".repeat(121)]))).toBe("23514");
    expect(codigo(await falla(`INSERT INTO "FamiliaDeProducto" ("id","empresaId","nombre","nombreClave","creadoPorId","actualizadoEn","version") VALUES ($1,$2,'Gaseosas','gaseosas','u_fam',now(),0)`, [F1, E]))).toBe("23514");
    expect(codigo(await falla(`INSERT INTO "FamiliaDeProducto" ("id","empresaId","nombre","nombreClave","creadoPorId","actualizadoEn") VALUES ('no-es-uuid',$1,'Gaseosas','gaseosas','u_fam',now())`, [E]))).toBe("22P02");
    await nuevaFamilia(F1, "Gaseosas");
    expect(await q(`SELECT "agruparEnCarta","agruparEnPos","activa","version" FROM "FamiliaDeProducto" WHERE "id" = $1`, [F1])).toEqual([{ agruparEnCarta: false, agruparEnPos: false, activa: true, version: 1 }]);
    expect(codigo(await falla(`INSERT INTO "FamiliaDeProducto" ("id","empresaId","nombre","nombreClave","creadoPorId","actualizadoEn") VALUES ($1,$2,'GASEOSAS','gaseosas','u_fam',now())`, [F2, E]))).toBe("23505");
    await nuevaFamilia(FAJENA, "Gaseosas", E2);
    await nuevaFamilia(F2, "Aguas");
    expect(await q(`SELECT count(*)::int AS n FROM "FamiliaDeProducto"`)).toEqual([{ n: 3 }]);
  });

  it("la base decide el MIEMBRO: un producto en una sola familia a la vez (23505), una posición por familia (23505), posición fuera de 1 a 1000 (23514), quitado sin quién (23514), familia o producto de OTRA empresa (23503)", async () => {
    await nuevoMiembro(nuevoUuid(), F1, "p1", 1);
    expect(codigo(await falla(SQL_MIEMBRO, [nuevoUuid(), E, F2, "p1", 1]))).toBe("23505"); // el mismo producto en otra familia
    expect(codigo(await falla(SQL_MIEMBRO, [nuevoUuid(), E, F1, "p1", 2]))).toBe("23505"); // el mismo producto en la misma familia (vigente dos veces)
    expect(codigo(await falla(SQL_MIEMBRO, [nuevoUuid(), E, F1, "p2", 1]))).toBe("23505"); // la misma posición
    expect(codigo(await falla(SQL_MIEMBRO, [nuevoUuid(), E, F1, "p2", 0]))).toBe("23514");
    expect(codigo(await falla(SQL_MIEMBRO, [nuevoUuid(), E, F1, "p2", 1001]))).toBe("23514");
    expect(await falla(SQL_MIEMBRO, [nuevoUuid(), E, F1, "p2", 1000])).toBe("sin error"); // 1000 es el tope permitido
    expect(codigo(await falla(`INSERT INTO "MiembroDeFamilia" ("id","empresaId","familiaId","productoId","posicion","agregadoPorId","agregadoEn","quitadoEn") VALUES ($1,$2,$3,'p2',5,'u_fam',now(),now())`, [nuevoUuid(), E, F1]))).toBe("23514");
    expect(codigo(await falla(SQL_MIEMBRO, [nuevoUuid(), E, FAJENA, "p2", 5]))).toBe("23503"); // la familia es de otra empresa
    expect(codigo(await falla(SQL_MIEMBRO, [nuevoUuid(), E, F1, "p_ajeno", 5]))).toBe("23503"); // el producto es de otra empresa
    expect(codigo(await falla(SQL_MIEMBRO, [nuevoUuid(), E2, F1, "p2", 5]))).toBe("23503"); // la empresa no es la de la familia
  });

  it("un miembro QUITADO no cambia más; quitar escribe quién y cuándo juntos; la identidad no cambia; volver a agregar es una fila NUEVA; no se puede borrar (la app no tiene DELETE) ni cambiar columnas sin privilegio", async () => {
    const id = nuevoUuid();
    await nuevoMiembro(id, F2, "p3", 1);
    expect(codigo(await falla(`UPDATE "MiembroDeFamilia" SET "posicion" = 9 WHERE "id" = $1`, [id]))).toBe("23514"); // la posición no cambia
    expect(codigo(await falla(`UPDATE "MiembroDeFamilia" SET "productoId" = 'p4' WHERE "id" = $1`, [id]))).toBe("23514");
    expect(codigo(await falla(`UPDATE "MiembroDeFamilia" SET "quitadoEn" = now() WHERE "id" = $1`, [id]))).toBe("23514"); // sin quién: lo frena el CHECK
    await q(`UPDATE "MiembroDeFamilia" SET "quitadoEn" = now(), "quitadoPorId" = 'u_fam' WHERE "id" = $1`, [id]);
    expect(codigo(await falla(`UPDATE "MiembroDeFamilia" SET "quitadoEn" = now(), "quitadoPorId" = 'otro' WHERE "id" = $1`, [id]))).toBe("23514"); // quitado: no cambia más
    expect(codigo(await falla(`UPDATE "MiembroDeFamilia" SET "quitadoEn" = NULL, "quitadoPorId" = NULL WHERE "id" = $1`, [id]))).toBe("23514"); // no se «des-quita»
    // Quitado el producto, vuelve a poder agregarse (a la misma familia, en su misma posición) como una fila nueva; la quitada queda como historia.
    await nuevoMiembro(nuevoUuid(), F2, "p3", 1);
    expect(await q(`SELECT count(*)::int AS n FROM "MiembroDeFamilia" WHERE "productoId" = 'p3'`)).toEqual([{ n: 2 }]);
    // Como la app (`motor2_app`, con la empresa fijada): leer, no borrar, no tocar la identidad.
    const comoApp = { rol: "motor2_app", empresa: E };
    expect(codigo(await falla(`DELETE FROM "MiembroDeFamilia"`, [], comoApp))).toBe("42501");
    expect(codigo(await falla(`DELETE FROM "FamiliaDeProducto"`, [], comoApp))).toBe("42501");
    expect(codigo(await falla(`TRUNCATE "MiembroDeFamilia"`, [], comoApp))).toBe("42501");
    expect(codigo(await falla(`UPDATE "MiembroDeFamilia" SET "posicion" = 9`, [], comoApp))).toBe("42501");
    expect(codigo(await falla(`UPDATE "FamiliaDeProducto" SET "creadoPorId" = 'otro'`, [], comoApp))).toBe("42501");
    expect(codigo(await falla(`UPDATE "FamiliaDeProducto" SET "empresaId" = '${E2}'`, [], comoApp))).toBe("42501");
    expect(await falla(`UPDATE "FamiliaDeProducto" SET "nombre" = 'Otra', "nombreClave" = 'otra', "version" = 2, "actualizadoEn" = now() WHERE "id" = '${F2}'`, [], comoApp)).toBe("sin error");
    // El disparador de identidad frena también al dueño: id, empresa, autor y fecha de alta no cambian.
    expect(codigo(await falla(`UPDATE "FamiliaDeProducto" SET "creadoPorId" = 'otro' WHERE "id" = $1`, [F2]))).toBe("23514");
    expect(codigo(await falla(`UPDATE "FamiliaDeProducto" SET "id" = $2 WHERE "id" = $1`, [F2, nuevoUuid()]))).toBe("23514");
  });

  it("la RLS por empresa: la app solo ve las familias y los miembros de su empresa", async () => {
    const empresas = async (empresa: string) => {
      await base.cliente.query("BEGIN");
      try {
        await base.cliente.query(`SET LOCAL ROLE motor2_app`);
        await base.cliente.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
        return (await base.cliente.query<{ e: string }>(`SELECT DISTINCT "empresaId" AS e FROM "FamiliaDeProducto"`)).rows.map((r) => r.e);
      } finally {
        await base.cliente.query("ROLLBACK");
      }
    };
    expect(await empresas(E)).toEqual([E]);
    expect(await empresas(E2)).toEqual([E2]);
  });

  it("el CRUCE con el ítem agrupado (invariante TRANSITORIO): la base rechaza el miembro de un producto agrupado (activo o no, de cualquier sucursal) y la opción de un producto miembro vigente, aunque se saltee el caso de uso; las filas VIEJAS no se revalidan", async () => {
    // p6 ya estaba agrupado ANTES de la migración (fila vieja): sigue ahí, pero no puede entrar a una familia.
    const yaAgrupado = await falla(SQL_MIEMBRO, [nuevoUuid(), E, F1, "p6", 10]);
    expect(codigo(yaAgrupado)).toBe("23514");
    expect(yaAgrupado).toContain("producto_ya_agrupado");
    // p7 en un ítem agrupado INACTIVO de otra sucursal: igual bloquea (conservador).
    await q(SQL_OPCION, ["opcion_inactivo", E, "suc_fam_2", "item_fam_inactivo", "p7"]);
    expect(codigo(await falla(SQL_MIEMBRO, [nuevoUuid(), E, F1, "p7", 11]))).toBe("23514");
    // … y también cuando quien escribe NO ve esa sucursal (la RLS por sucursal del rol de la app): el disparador no mira el alcance. (Con la app como `motor2_app` y solo `suc_fam` en alcance.)
    const sinVerLaSucursal = await falla(SQL_MIEMBRO, [nuevoUuid(), E, F1, "p7", 11], { rol: "motor2_app", empresa: E, sucursales: ["suc_fam"] });
    expect(codigo(sinVerLaSucursal)).toBe("23514");
    expect(sinVerLaSucursal).toContain("producto_ya_agrupado");
    // El otro lado: p1 es miembro vigente de F1, así que no entra a un ítem agrupado (insertar ni cambiar el producto de una opción).
    const yaMiembro = await falla(SQL_OPCION, ["opcion_x", E, "suc_fam", "item_fam", "p1"]);
    expect(codigo(yaMiembro)).toBe("23514");
    expect(yaMiembro).toContain("producto_ya_miembro_de_familia");
    expect(codigo(await falla(`UPDATE "OpcionItemAgrupadoCarta" SET "productoId" = 'p1' WHERE "id" = 'opcion_vieja'`))).toBe("23514");
    // Un producto que NO es miembro entra al ítem agrupado sin problema; uno quitado de la familia, también.
    expect(await falla(SQL_OPCION, ["opcion_y", E, "suc_fam", "item_fam", "p5"])).toBe("sin error");
    await q(`UPDATE "MiembroDeFamilia" SET "quitadoEn" = now(), "quitadoPorId" = 'u_fam' WHERE "productoId" = 'p1' AND "quitadoEn" IS NULL`);
    expect(await falla(SQL_OPCION, ["opcion_z", E, "suc_fam", "item_fam", "p1"])).toBe("sin error");
    // Cambiar otra columna de una opción vieja no dispara el control (solo el cambio de producto).
    expect(await falla(`UPDATE "OpcionItemAgrupadoCarta" SET "orden" = 3 WHERE "id" = 'opcion_vieja'`)).toBe("sin error");
  });

  it("BAJAR CON FILAS aborta y no pierde nada; vacías, baja (y saca el disparador de la opción) y bajar dos veces no falla", async () => {
    expect(codigo(await falla(leer("down.sql")))).toBe("P0001");
    expect(Number((await q(`SELECT count(*)::int AS n FROM "FamiliaDeProducto"`))[0].n)).toBeGreaterThan(0);
    await q(`DELETE FROM "MiembroDeFamilia"`);
    await q(`DELETE FROM "FamiliaDeProducto"`);
    await correr("down.sql");
    expect(await existe("FamiliaDeProducto")).toBe(false);
    expect(await existe("MiembroDeFamilia")).toBe(false);
    expect(await q(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'OpcionItemAgrupadoCarta_no_si_en_familia'`)).toEqual([{ n: 0 }]);
    expect(await q(`SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('FamiliaDeProducto_proteger','MiembroDeFamilia_proteger','MiembroDeFamilia_no_si_agrupado','OpcionItemAgrupadoCarta_no_si_en_familia')`)).toEqual([{ n: 0 }]);
    // El ítem agrupado queda como estaba: se puede agrupar lo que quiera.
    expect(await q(`SELECT count(*)::int AS n FROM "OpcionItemAgrupadoCarta"`)).toEqual([{ n: 2 }]);
    await correr("down.sql");
    expect(await existe("FamiliaDeProducto")).toBe(false);
  });

  it("SUBIR OTRA VEZ: el catálogo de las tablas queda idéntico al de la primera subida", async () => {
    await correr("migration.sql");
    expect(await foto()).toEqual(primeraSubida);
  });
});
