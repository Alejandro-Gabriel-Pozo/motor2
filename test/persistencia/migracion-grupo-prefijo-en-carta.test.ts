import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Fase 4 de la ola «precio y carta», C2 — migración 20261021131000_grupo_prefijo_en_carta: `GrupoDeOpciones.prefijoEnCarta` («se lee en la carta como»), TEXT NULL con CHECK (visible, sin espacios a
 * los costados, hasta 20 caracteres) y su GRANT de UPDATE POR COLUMNA para `motor2_app` (la tabla tiene privilegios por columna desde GO-1b: sin el GRANT, editar el prefijo da 42501). Sobre una base
 * temporal armada migración por migración, con un grupo CARGADO ANTES de la migración. Los privilegios de `GrupoDeOpciones` vienen de las migraciones (los bloques condicionales al rol de GO-1b y de esta).
 *
 * Qué fija: (a) el grupo viejo queda con el prefijo en NULL y lo demás intacto; (b) como motor2_app (RLS por empresa puesta) se puede escribir y vaciar el prefijo; (c) 23514 con 21 caracteres, con solo
 * espacios, vacío y con espacios a los costados (20 pasan); (d) las columnas actualizables por motor2_app son las de GO-1b más el prefijo, sin políticas nuevas; (e) el down.sql ABORTA si hay un prefijo
 * cargado; (f) subir, bajar y subir deja el catálogo (y los privilegios por columna) idéntico.
 *
 * Mutaciones: sacar el GRANT rompe (b) (42501) y (d); cambiar 20 por 21 rompe (c).
 */
const NOMBRE = "20261021131000_grupo_prefijo_en_carta";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const E = "emp-prefijo";

let base: BaseTemporalMigrada;
let hayRol = false;
let app: Client | null = null;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function fotoDelGrupo() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'GrupoDeOpciones' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"GrupoDeOpciones"'::regclass ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'GrupoDeOpciones' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`),
    privilegiosPorColumna: await q(`SELECT grantee::text AS rol, column_name::text AS columna, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = 'GrupoDeOpciones' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'GrupoDeOpciones' ORDER BY 1`),
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

/** Corre `consulta` como `motor2_app` en una transacción con la empresa puesta y SIEMPRE hace ROLLBACK. */
async function comoAppConRollback<T>(consulta: (c: Client) => Promise<T>): Promise<T> {
  app ??= await conectarComoApp();
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.empresa_id', $1, true)", [E]);
    return await consulta(app);
  } finally {
    await app.query("ROLLBACK");
  }
}

const actualizables = async () =>
  (await q<{ columna: string }>(
    `SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"GrupoDeOpciones"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`,
  )).map((c) => c.columna);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  await base.aplicarAntesDe(NOMBRE);
  await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await base.cliente.query(`INSERT INTO "GrupoDeOpciones" ("id","empresaId","nombre","tipo","cantidadMinima","cantidadMaxima") VALUES ('grupo-viejo',$1,'Milanesas de','VARIANTE',1,1)`, [E]);
  fotoAntes = await fotoDelGrupo();
}, 120_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await base?.eliminar();
}, 60_000);

describe("Fase 4, C2: «se lee en la carta como» del grupo (migración 20261021131000)", () => {
  it("(a) al aplicar, el grupo viejo queda con el prefijo en NULL y lo demás sin cambios; la columna es TEXT nulable, sin default, al final de la tabla", async () => {
    const antes = (await q(`SELECT * FROM "GrupoDeOpciones" WHERE "id" = 'grupo-viejo'`))[0];
    await base.cliente.query(leer("migration.sql"));
    const despues = (await q(`SELECT * FROM "GrupoDeOpciones" WHERE "id" = 'grupo-viejo'`))[0] as Record<string, unknown>;
    expect(despues.prefijoEnCarta).toBeNull();
    expect(Object.fromEntries(Object.entries(despues).filter(([c]) => c !== "prefijoEnCarta")), "ninguna otra columna cambió").toEqual(antes);
    const columnas = (await fotoDelGrupo()).columnas as { columna: string }[];
    expect(columnas.at(-1)).toEqual({ columna: "prefijoEnCarta", data_type: "text", is_nullable: "YES", column_default: null });
  });

  it("(b) como motor2_app (con la empresa de la sesión): se escribe el prefijo, se cambia y se vacía (vuelve a NULL)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await comoAppConRollback(async (c) => {
      expect((await c.query(`UPDATE "GrupoDeOpciones" SET "prefijoEnCarta" = 'De' WHERE "id" = 'grupo-viejo'`)).rowCount).toBe(1);
      expect((await c.query(`SELECT "prefijoEnCarta" FROM "GrupoDeOpciones" WHERE "id" = 'grupo-viejo'`)).rows[0]).toEqual({ prefijoEnCarta: "De" });
      expect((await c.query(`UPDATE "GrupoDeOpciones" SET "prefijoEnCarta" = NULL WHERE "id" = 'grupo-viejo'`)).rowCount).toBe(1);
      expect((await c.query(`SELECT "prefijoEnCarta" FROM "GrupoDeOpciones" WHERE "id" = 'grupo-viejo'`)).rows[0]).toEqual({ prefijoEnCarta: null });
    });
  });

  it("(c) el CHECK: 21 caracteres, solo espacios, vacío o con espacios a los costados dan 23514; hasta 20 (con tildes y letras de cualquier alfabeto) pasan", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const malo of ["x".repeat(21), "  ", "", " De", "De ", "\tCon"]) {
      await comoAppConRollback(async (c) => {
        await expect(c.query(`UPDATE "GrupoDeOpciones" SET "prefijoEnCarta" = $1 WHERE "id" = 'grupo-viejo'`, [malo]), JSON.stringify(malo)).rejects.toMatchObject({ code: "23514", constraint: "GrupoDeOpciones_prefijo_en_carta_chk" });
      });
    }
    for (const bueno of ["x".repeat(20), "Con", "De la casa", "Ñandú y más"]) {
      await comoAppConRollback(async (c) => {
        expect((await c.query(`UPDATE "GrupoDeOpciones" SET "prefijoEnCarta" = $1 WHERE "id" = 'grupo-viejo'`, [bueno])).rowCount, bueno).toBe(1);
      });
    }
  });

  it("(d) motor2_app puede actualizar EXACTAMENTE las columnas de GO-1b más el prefijo; sin políticas ni privilegios de tabla nuevos", async () => {
    const despues = (await fotoDelGrupo()) as Record<string, unknown[]>;
    const antes = fotoAntes as Record<string, unknown[]>;
    expect(despues.politicas).toEqual(antes.politicas);
    expect(despues.privilegios).toEqual(antes.privilegios);
    expect(despues.restricciones.length).toBe(antes.restricciones.length + 1);
    if (hayRol) expect(await actualizables()).toEqual(["activo", "actualizadoEn", "cantidadMaxima", "cantidadMinima", "nombre", "prefijoEnCarta", "version"]);
  });

  it("(e) el down.sql ABORTA si hay un prefijo cargado, sin tocar nada", async () => {
    await base.cliente.query(`UPDATE "GrupoDeOpciones" SET "prefijoEnCarta" = 'De' WHERE "id" = 'grupo-viejo'`);
    const arriba = await fotoDelGrupo();
    await base.cliente.query("BEGIN");
    await expect(base.cliente.query(leer("down.sql"))).rejects.toThrow(/hay 1 grupo\(s\) con «se lee en la carta como» cargado/);
    await base.cliente.query("ROLLBACK");
    expect(await fotoDelGrupo()).toEqual(arriba);
    await base.cliente.query(`UPDATE "GrupoDeOpciones" SET "prefijoEnCarta" = NULL WHERE "id" = 'grupo-viejo'`);
  });

  it("(f) SUBIR, BAJAR, SUBIR: el down.sql deja el catálogo y los privilegios por columna como antes, es idempotente, y volver a subir lo deja como la primera vez", async () => {
    const arriba = await fotoDelGrupo();
    await base.cliente.query(leer("down.sql"));
    expect(await fotoDelGrupo(), "bajado = antes de la migración").toEqual(fotoAntes);
    expect((await q(`SELECT "id","nombre","tipo" FROM "GrupoDeOpciones"`))).toEqual([{ id: "grupo-viejo", nombre: "Milanesas de", tipo: "VARIANTE" }]);
    await base.cliente.query(leer("down.sql"));
    await base.cliente.query(leer("migration.sql"));
    expect(await fotoDelGrupo(), "subido otra vez = la primera subida").toEqual(arriba);
  });
});
