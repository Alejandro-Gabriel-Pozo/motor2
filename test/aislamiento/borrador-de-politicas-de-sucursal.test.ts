import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CANTIDAD_DE_POLITICAS_ESPERADAS, TABLAS_CON_POLITICA_DE_SUCURSAL } from "../setup/clasificacion-de-tablas";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";
import { sqlDeAlcanceDeSucursal, sqlDeReversaDeAlcanceDeSucursal } from "../setup/politicas-de-alcance-de-sucursal";

/**
 * M.3, Fase A, paso A9, contra Postgres REAL: el SQL que genera `test/setup/politicas-de-alcance-de-sucursal.ts` (borrador de la Fase B, NO es una migración) se aplica sobre una base
 * TEMPORAL con todas las migraciones (`crearBaseTemporalMigrada`, que se niega a correr fuera de un Postgres local y borra la base al terminar; jamás `motor2_dev` ni `motor2_e2e`),
 * se revierte y se vuelve a aplicar. Además un humo funcional (cinco lecturas y cinco escrituras como `motor2_app`) prueba que las políticas hacen lo que dicen; el escenario completo de
 * aislamiento (dos sucursales con todos los cruces, concurrencia, traspasos) es del paso A10.
 *
 * El rol `motor2_app` es del cluster: si no existe (un Postgres de CI sin el paso de roles) los casos se omiten con motivo, igual que `grants-m1-con-base.test.ts`. Los GRANT sobre las tablas
 * de la base temporal los da este archivo (los privilegios por defecto del script de roles son por base y la temporal nace sin ellos); se van con la base.
 */
let base: BaseTemporalMigrada;
let hayRol = false;
let app: Client | null = null;

const E = "empresa_a";

async function existeElRol(cliente: Client): Promise<boolean> {
  return (await cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarRestantes();
  hayRol = await existeElRol(base.cliente);
  if (!hayRol) return;
  const q = (sql: string, params: unknown[] = []) => base.cliente.query(sql, params);
  await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);
  await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  for (const s of ["sA", "sB"]) await q(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ($1,$2,$1)`, [s, E]);
  await q(`INSERT INTO "User" ("id","email") VALUES ('u1','u1@ejemplo.test')`);
  for (const [id, suc] of [["secA", "sA"], ["secB", "sB"]]) await q(`INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre") VALUES ($1,$2,$3,$1)`, [id, E, suc]);
  for (const [id, suc] of [["mesaA", "sA"], ["mesaB", "sB"]]) await q(`INSERT INTO "Mesa" ("id","empresaId","sucursalId","numero") VALUES ($1,$2,$3,1)`, [id, E, suc]);
  for (const [id, mesa] of [["cuentaA", "mesaA"], ["cuentaB", "mesaB"]]) await q(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId") VALUES ($1,$2,$3,'u1')`, [id, E, mesa]);
  for (const [id, suc] of [["audNula", null], ["audA", "sA"], ["audB", "sB"]]) {
    await q(`INSERT INTO "RegistroAuditoria" ("id","empresaId","sucursalId","entidad","entidadId","descripcion","campo","actorId") VALUES ($1,$2,$3,'x','x','d','c','u1')`, [id, E, suc]);
  }
});

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await base?.eliminar();
});

/** Una conexión como `motor2_app` (el rol de la app, sujeto a RLS) a la base temporal. */
async function conectarComoApp(): Promise<Client> {
  const credenciales = new URL(process.env.DATABASE_URL as string);
  const destino = new URL(base.url);
  const cliente = new Client({
    host: destino.hostname,
    port: destino.port ? Number(destino.port) : 5432,
    user: decodeURIComponent(credenciales.username),
    password: decodeURIComponent(credenciales.password),
    database: decodeURIComponent(destino.pathname.replace(/^\//, "")),
  });
  await cliente.connect();
  return cliente;
}

interface Alcance {
  lectura?: string;
  escritura?: string;
}

/** Corre `fn` dentro de una transacción como `motor2_app`, con la empresa y el alcance fijados (locales a la transacción), y siempre hace ROLLBACK. */
async function conAlcance<T>(alcance: Alcance, fn: (c: Client) => Promise<T>): Promise<T> {
  app ??= await conectarComoApp();
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.empresa_id', $1, true)", [E]);
    if (alcance.lectura !== undefined) await app.query("SELECT set_config('app.sucursales_lectura', $1, true)", [alcance.lectura]);
    if (alcance.escritura !== undefined) await app.query("SELECT set_config('app.sucursales_escritura', $1, true)", [alcance.escritura]);
    return await fn(app);
  } finally {
    await app.query("ROLLBACK");
  }
}

const ids = async (c: Client, tabla: string) => (await c.query<{ id: string }>(`SELECT "id" FROM "${tabla}" ORDER BY "id"`)).rows.map((r) => r.id);

/** El código SQLSTATE con el que falla una sentencia (dentro de un SAVEPOINT, para no abortar la transacción), o null si anduvo. */
async function falla(c: Client, sql: string, params: unknown[] = []): Promise<string | null> {
  await c.query("SAVEPOINT intento");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT intento");
    return null;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT intento");
    return (e as { code?: string }).code ?? "sin código";
  }
}

const politicasDeAlcance = async () =>
  (
    await base.cliente.query<{ tabla: string; nombre: string; tipo: string; comando: string; roles: string[] }>(
      `SELECT tablename::text AS tabla, policyname::text AS nombre, permissive AS tipo, cmd AS comando, roles::text[] AS roles FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'alcance\\_sucursal\\_%' ORDER BY 1, 2`,
    )
  ).rows;
const totalDePoliticas = async () => Number((await base.cliente.query<{ n: string }>(`SELECT count(*) AS n FROM pg_policies WHERE schemaname = 'public'`)).rows[0]!.n);
const funcionesDeAlcance = async () => (await base.cliente.query<{ f: string }>(`SELECT proname::text AS f FROM pg_proc WHERE proname LIKE 'app\\_sucursales\\_%' ORDER BY 1`)).rows.map((r) => r.f);

describe("el borrador de políticas de sucursal, sobre una base migrada de verdad", () => {
  it("el SQL del alta se aplica sin error y deja las funciones y las cuatro políticas RESTRICTIVE TO motor2_app de cada tabla con alcance", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const antes = await totalDePoliticas();
    expect(antes, "las políticas por empresa de hoy, derivadas de la clasificación por empresa").toBe(CANTIDAD_DE_POLITICAS_ESPERADAS);
    await base.cliente.query(sqlDeAlcanceDeSucursal());
    const politicas = await politicasDeAlcance();
    expect(politicas).toHaveLength(TABLAS_CON_POLITICA_DE_SUCURSAL.length * 4);
    expect([...new Set(politicas.map((p) => p.tabla))].sort()).toEqual([...TABLAS_CON_POLITICA_DE_SUCURSAL].sort());
    for (const p of politicas) {
      expect(p.tipo, `${p.tabla}/${p.nombre}`).toBe("RESTRICTIVE");
      expect(p.roles, `${p.tabla}/${p.nombre}`).toEqual(["motor2_app"]);
    }
    for (const t of TABLAS_CON_POLITICA_DE_SUCURSAL) expect(politicas.filter((p) => p.tabla === t).map((p) => p.comando).sort(), t).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
    expect(await totalDePoliticas(), "se suman a las de empresa sin tocarlas").toBe(antes + politicas.length);
    expect(await funcionesDeAlcance()).toEqual(["app_sucursales_escritura", "app_sucursales_lectura"]);
  });

  it("las funciones devuelven NULL sin variable o con la variable vacía, y la lectura efectiva es lectura ∪ escritura", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const leer = async (lectura: string | null, escritura: string | null) => {
      await base.cliente.query("BEGIN");
      try {
        if (lectura !== null) await base.cliente.query("SELECT set_config('app.sucursales_lectura', $1, true)", [lectura]);
        if (escritura !== null) await base.cliente.query("SELECT set_config('app.sucursales_escritura', $1, true)", [escritura]);
        const r = await base.cliente.query<{ l: string[] | null; e: string[] | null }>("SELECT app_sucursales_lectura() AS l, app_sucursales_escritura() AS e");
        return { l: r.rows[0]!.l?.slice().sort() ?? null, e: r.rows[0]!.e?.slice().sort() ?? null };
      } finally {
        await base.cliente.query("ROLLBACK");
      }
    };
    expect(await leer(null, null)).toEqual({ l: null, e: null });
    expect(await leer("", "")).toEqual({ l: null, e: null });
    expect(await leer("sA,sB", null)).toEqual({ l: ["sA", "sB"], e: null });
    expect(await leer(null, "sC")).toEqual({ l: ["sC"], e: ["sC"] });
    expect(await leer("sA,sB", "sB,sC")).toEqual({ l: ["sA", "sB", "sB", "sC"], e: ["sB", "sC"] });
  });

  it("humo: sin alcance no se ve ni se escribe nada; con lectura se ve solo lo de esa sucursal; con escritura solo se escribe en ella (propias, hijas y de empresa)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    // Sin variables de sucursal (solo la empresa): falla cerrado, también con las filas de empresa (sucursalId NULL).
    await conAlcance({}, async (c) => {
      for (const t of ["Seccion", "Mesa", "Cuenta", "RegistroAuditoria"]) expect(await ids(c, t), `${t} sin alcance`).toEqual([]);
      expect(await falla(c, `INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre") VALUES ('nueva','${E}','sA','nueva')`)).toBe("42501");
    });
    // Solo lectura en sA: ve lo de sA (y la fila de empresa), no lo de sB; no escribe.
    await conAlcance({ lectura: "sA" }, async (c) => {
      expect(await ids(c, "Seccion")).toEqual(["secA"]);
      expect(await ids(c, "Mesa")).toEqual(["mesaA"]);
      expect(await ids(c, "Cuenta"), "hija de Mesa").toEqual(["cuentaA"]);
      expect(await ids(c, "RegistroAuditoria"), "NULL = de la empresa, visible con alcance").toEqual(["audA", "audNula"]);
      expect(await falla(c, `INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre") VALUES ('nueva','${E}','sA','nueva')`), "lectura no escribe").toBe("42501");
      expect((await c.query(`UPDATE "Seccion" SET "nombre" = 'otro' WHERE "id" = 'secA'`)).rowCount, "lectura no actualiza").toBe(0);
    });
    // Solo escritura en sA: la lectura efectiva incluye la escritura; no se escribe en sB ni se mueve una fila a sB.
    await conAlcance({ escritura: "sA" }, async (c) => {
      expect(await ids(c, "Seccion")).toEqual(["secA"]);
      expect(await falla(c, `INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre") VALUES ('nueva','${E}','sA','nueva')`)).toBeNull();
      expect(await falla(c, `INSERT INTO "Seccion" ("id","empresaId","sucursalId","nombre") VALUES ('ajena','${E}','sB','ajena')`), "INSERT cruzado").toBe("42501");
      expect((await c.query(`UPDATE "Seccion" SET "nombre" = 'otro' WHERE "id" = 'secB'`)).rowCount, "UPDATE cruzado").toBe(0);
      expect((await c.query(`DELETE FROM "Seccion" WHERE "id" = 'secB'`)).rowCount, "DELETE cruzado").toBe(0);
      expect(await falla(c, `UPDATE "Seccion" SET "sucursalId" = 'sB' WHERE "id" = 'secA'`), "mover una fila a otra sucursal").toBe("42501");
      expect(await falla(c, `INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId","cerradaEn","cerradaPorId") VALUES ('c2','${E}','mesaA','u1',now(),'u1')`), "hija en el padre propio").toBeNull();
      expect(await falla(c, `INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId","cerradaEn","cerradaPorId") VALUES ('c3','${E}','mesaB','u1',now(),'u1')`), "hija en el padre ajeno").toBe("42501");
      expect(await falla(c, `INSERT INTO "RegistroAuditoria" ("id","empresaId","sucursalId","entidad","entidadId","descripcion","campo","actorId") VALUES ('a1','${E}',NULL,'x','x','d','c','u1')`), "fila de empresa con alcance de escritura").toBeNull();
      expect(await falla(c, `INSERT INTO "RegistroAuditoria" ("id","empresaId","sucursalId","entidad","entidadId","descripcion","campo","actorId") VALUES ('a2','${E}','sB','x','x','d','c','u1')`)).toBe("42501");
    });
    // Lectura en sA y escritura en sB: ve las dos, escribe solo en sB.
    await conAlcance({ lectura: "sA", escritura: "sB" }, async (c) => {
      expect(await ids(c, "Seccion")).toEqual(["secA", "secB"]);
      expect((await c.query(`UPDATE "Seccion" SET "nombre" = 'otro' WHERE "id" = 'secA'`)).rowCount).toBe(0);
      expect((await c.query(`UPDATE "Seccion" SET "nombre" = 'otro' WHERE "id" = 'secB'`)).rowCount).toBe(1);
    });
  });

  it("la reversa borra exactamente lo que el alta creó, deja las políticas por empresa como estaban, y alta → reversa → alta funciona", async (ctx) => {
    if (!hayRol) return ctx.skip();
    const conPoliticas = await totalDePoliticas();
    await base.cliente.query(sqlDeReversaDeAlcanceDeSucursal());
    expect(await politicasDeAlcance()).toEqual([]);
    expect(await funcionesDeAlcance()).toEqual([]);
    expect(await totalDePoliticas()).toBe(CANTIDAD_DE_POLITICAS_ESPERADAS);
    await base.cliente.query(sqlDeReversaDeAlcanceDeSucursal()); // idempotente: IF EXISTS
    // Sin las políticas el rol de la app vuelve a ver todo lo de su empresa (la reversa devuelve el comportamiento de antes).
    await conAlcance({}, async (c) => expect(await ids(c, "Seccion")).toEqual(["secA", "secB"]));
    await base.cliente.query(sqlDeAlcanceDeSucursal());
    expect(await totalDePoliticas()).toBe(conPoliticas);
    await conAlcance({ lectura: "sA" }, async (c) => expect(await ids(c, "Seccion")).toEqual(["secA"]));
    await base.cliente.query(sqlDeReversaDeAlcanceDeSucursal());
    expect(await totalDePoliticas()).toBe(CANTIDAD_DE_POLITICAS_ESPERADAS);
  });
});
