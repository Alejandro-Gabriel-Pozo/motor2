import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Interruptor «solo salón» de las promociones (docs/diseno-promo-solo-salon-2026-10-26.md, paso 2) — migración 20261026120000_promo_carta_solo_salon: `PromoCarta.soloSalon`, BOOLEAN NOT NULL DEFAULT false.
 * Sobre una base temporal armada migración por migración, con promos CARGADAS ANTES de la migración. SOLO contra una base local temporal (`crearBaseTemporalMigrada` se niega a correr fuera de un Postgres local).
 *
 * Qué fija: (a) la promo vieja queda en `false` (se sigue viendo en la carta, como hoy) y todo lo demás intacto; la columna es BOOLEAN NOT NULL DEFAULT false, al final de la tabla; (b) como motor2_app, con la empresa de
 * la sesión (RLS por empresa), se prende y se apaga, la promo de OTRA empresa no se toca (0 filas) ni se ve, y NULL se rechaza; (c) sin políticas, restricciones, índices ni privilegios nuevos (la tabla tiene
 * privilegios de TABLA); (d) el down.sql ABORTA si hay alguna promo en «solo salón», sin tocar nada (bajarla las haría públicas); (e) subir, bajar y subir deja el catálogo idéntico, y bajar dos veces no falla.
 *
 * Mutaciones: borrar el `RAISE` del down.sql rompe (d); `DEFAULT true` rompe (a).
 */
const NOMBRE = "20261026120000_promo_carta_solo_salon";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const E = "emp-solo-salon";
const OTRA = "emp-solo-salon-otra";

let base: BaseTemporalMigrada;
let hayRol = false;
let app: Client | null = null;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function fotoDeLaPromo() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'PromoCarta' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"PromoCarta"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'PromoCarta' ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'PromoCarta' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`),
    privilegiosPorColumna: await q(`SELECT grantee::text AS rol, column_name::text AS columna, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = 'PromoCarta' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'PromoCarta' ORDER BY 1`),
  };
}

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

/** Corre `consulta` como `motor2_app` en una transacción con la empresa de la sesión dada (RLS por empresa), y SIEMPRE hace ROLLBACK. */
async function comoAppConRollback<T>(empresa: string, consulta: (c: Client) => Promise<T>): Promise<T> {
  app ??= await conectarComoApp();
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.empresa_id', $1, true)", [empresa]);
    return await consulta(app);
  } finally {
    await app.query("ROLLBACK");
  }
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  await base.aplicarAntesDe(NOMBRE);
  for (const e of [E, OTRA]) {
    await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
    await base.cliente.query(`INSERT INTO "SeccionCarta" ("id","empresaId","nombre") VALUES ($2,$1,'Menús')`, [e, `seccion-${e}`]);
    await base.cliente.query(`INSERT INTO "PromoCarta" ("id","empresaId","seccionCartaId","titulo","precio") VALUES ($2,$1,$3,'Combo',25000)`, [e, `promo-${e}`, `seccion-${e}`]);
  }
  // En una base temporal los privilegios de TABLA del rol no vienen de las migraciones (los da `scripts/operaciones/crear-rol-motor2-app.sql`): se le dan a mano, ANTES de la foto.
  if (hayRol) await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "PromoCarta" TO motor2_app`);
  fotoAntes = await fotoDeLaPromo();
}, 120_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await base?.eliminar();
}, 60_000);

describe("interruptor «solo salón» de las promos (migración 20261026120000)", () => {
  it("(a) al aplicar, la promo vieja queda en false (se sigue viendo en la carta) y lo demás sin cambios; la columna es BOOLEAN NOT NULL DEFAULT false, al final de la tabla", async () => {
    const antes = await q(`SELECT * FROM "PromoCarta" ORDER BY "id"`);
    await base.cliente.query(leer("migration.sql"));
    const despues = (await q(`SELECT * FROM "PromoCarta" ORDER BY "id"`)) as Record<string, unknown>[];
    expect(despues.map((f) => f.soloSalon)).toEqual([false, false]);
    expect(despues.map((f) => Object.fromEntries(Object.entries(f).filter(([c]) => c !== "soloSalon"))), "ninguna otra columna cambió").toEqual(antes);
    const columnas = (await fotoDeLaPromo()).columnas as { columna: string }[];
    expect(columnas.at(-1)).toEqual({ columna: "soloSalon", data_type: "boolean", is_nullable: "NO", column_default: "false" });
  });

  it("(b) como motor2_app: se prende y se apaga en la empresa de la sesión; la promo de otra empresa no se ve ni se toca (RLS por empresa); NULL se rechaza", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await comoAppConRollback(E, async (c) => {
      expect((await c.query(`UPDATE "PromoCarta" SET "soloSalon" = true`)).rowCount, "solo la promo de la empresa de la sesión").toBe(1);
      expect((await c.query(`SELECT "empresaId", "soloSalon" FROM "PromoCarta"`)).rows).toEqual([{ empresaId: E, soloSalon: true }]);
      expect((await c.query(`UPDATE "PromoCarta" SET "soloSalon" = false WHERE "id" = $1`, [`promo-${E}`])).rowCount).toBe(1);
      expect((await c.query(`UPDATE "PromoCarta" SET "soloSalon" = true WHERE "id" = $1`, [`promo-${OTRA}`])).rowCount, "la de otra empresa: 0 filas").toBe(0);
      await expect(c.query(`UPDATE "PromoCarta" SET "soloSalon" = NULL WHERE "id" = $1`, [`promo-${E}`])).rejects.toMatchObject({ code: "23502" });
    });
  });

  it("(c) sin políticas, restricciones, índices ni privilegios nuevos: la tabla tiene privilegios de TABLA, que cubren la columna", async () => {
    const despues = (await fotoDeLaPromo()) as Record<string, unknown[]>;
    const antes = fotoAntes as Record<string, unknown[]>;
    for (const k of ["restricciones", "indices", "privilegios", "politicas"]) expect(despues[k], k).toEqual(antes[k]);
    // Sin privilegios por columna: los de la columna nueva son los mismos de tabla (si alguien agregara un GRANT por columna, cambiaría acá).
    expect((despues.privilegiosPorColumna as { columna: string }[]).filter((p) => p.columna !== "soloSalon")).toEqual(antes.privilegiosPorColumna);
  });

  it("(d) el down.sql ABORTA si hay alguna promo en «solo salón» (bajarla la haría pública), sin tocar nada", async () => {
    await base.cliente.query(`UPDATE "PromoCarta" SET "soloSalon" = true WHERE "id" = $1`, [`promo-${OTRA}`]);
    const arriba = await fotoDeLaPromo();
    await base.cliente.query("BEGIN");
    await expect(base.cliente.query(leer("down.sql"))).rejects.toThrow(/hay 1 promo\(s\) con «solo salón» prendido/);
    await base.cliente.query("ROLLBACK");
    expect(await fotoDeLaPromo()).toEqual(arriba);
    expect((await q(`SELECT "soloSalon" FROM "PromoCarta" WHERE "id" = $1`, [`promo-${OTRA}`]))[0]).toEqual({ soloSalon: true });
    await base.cliente.query(`UPDATE "PromoCarta" SET "soloSalon" = false WHERE "id" = $1`, [`promo-${OTRA}`]);
  });

  it("(e) SUBIR, BAJAR, SUBIR: el down.sql deja el catálogo como antes (sin perder filas), es idempotente, y volver a subir lo deja como la primera vez", async () => {
    const arriba = await fotoDeLaPromo();
    await base.cliente.query(leer("down.sql"));
    expect(await fotoDeLaPromo(), "bajado = antes de la migración").toEqual(fotoAntes);
    expect(await q(`SELECT "id", "titulo", "precio" FROM "PromoCarta" ORDER BY "id"`)).toEqual([
      { id: `promo-${E}`, titulo: "Combo", precio: "25000.00" },
      { id: `promo-${OTRA}`, titulo: "Combo", precio: "25000.00" },
    ]);
    await base.cliente.query(leer("down.sql"));
    await base.cliente.query(leer("migration.sql"));
    expect(await fotoDeLaPromo(), "subido otra vez = la primera subida").toEqual(arriba);
  });
});
