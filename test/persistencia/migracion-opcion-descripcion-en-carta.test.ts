import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Carta «B», E3 — migración 20261104120000_opcion_descripcion_en_carta: `OpcionDeGrupo.descripcionEnCarta` (la descripción opcional de una opción, que lee solo la carta), TEXT NULL con CHECK (de 1 a 120
 * caracteres, visible a los costados y sin saltos de línea) y su GRANT de UPDATE POR COLUMNA para `motor2_app` (la tabla tiene privilegios por columna desde GO-1b: sin el GRANT, editar la descripción da
 * 42501). Sobre una base temporal armada migración por migración, con una opción CARGADA ANTES de la migración.
 *
 * Qué fija: (a) la opción vieja queda con la descripción en NULL y lo demás intacto; (b) como motor2_app (RLS por empresa puesta) se puede escribir, cambiar y vaciar la descripción; (c) 23514 con 121
 * caracteres, con solo espacios, vacío, con espacios a los costados y con un salto de línea adentro (120 pasan); (d) las columnas actualizables por motor2_app son las de GO-1b más la descripción, sin
 * políticas nuevas; (e) el down.sql ABORTA si hay una descripción cargada; (f) subir, bajar y subir deja el catálogo (y los privilegios por columna) idéntico, y bajar sin descripciones es limpio.
 *
 * Mutaciones: sacar el GRANT rompe (b) (42501) y (d); cambiar 120 por 121 rompe (c); sacar el `!~ '[\r\n]'` rompe (c) con el salto de línea.
 */

const NOMBRE = "20261104120000_opcion_descripcion_en_carta";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const E = "emp-descripcion";

let base: BaseTemporalMigrada;
let hayRol = false;
let app: Client | null = null;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function fotoDeLaOpcion() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'OpcionDeGrupo' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"OpcionDeGrupo"'::regclass ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'OpcionDeGrupo' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`),
    privilegiosPorColumna: await q(`SELECT grantee::text AS rol, column_name::text AS columna, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = 'OpcionDeGrupo' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'OpcionDeGrupo' ORDER BY 1`),
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
    `SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"OpcionDeGrupo"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`,
  )).map((c) => c.columna);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  await base.aplicarAntesDe(NOMBRE);
  await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await base.cliente.query(`INSERT INTO "GrupoDeOpciones" ("id","empresaId","nombre","tipo","cantidadMinima","cantidadMaxima") VALUES ('grupo-g',$1,'Guarnición','INCLUIDA',1,1)`, [E]);
  await base.cliente.query(`INSERT INTO "OpcionDeGrupo" ("id","empresaId","grupoId","nombre") VALUES ('opcion-vieja',$1,'grupo-g','Ensalada')`, [E]);
  fotoAntes = await fotoDeLaOpcion();
}, 120_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await base?.eliminar();
}, 60_000);

describe("Carta «B», E3: descripción de la opción (migración 20261104120000)", () => {
  it("(a) al aplicar, la opción vieja queda con la descripción en NULL y lo demás sin cambios; la columna es TEXT nulable, sin default, al final de la tabla", async () => {
    const antes = (await q(`SELECT * FROM "OpcionDeGrupo" WHERE "id" = 'opcion-vieja'`))[0];
    await base.cliente.query(leer("migration.sql"));
    const despues = (await q(`SELECT * FROM "OpcionDeGrupo" WHERE "id" = 'opcion-vieja'`))[0] as Record<string, unknown>;
    expect(despues.descripcionEnCarta).toBeNull();
    expect(Object.fromEntries(Object.entries(despues).filter(([c]) => c !== "descripcionEnCarta")), "ninguna otra columna cambió").toEqual(antes);
    const columnas = (await fotoDeLaOpcion()).columnas as { columna: string }[];
    expect(columnas.at(-1)).toEqual({ columna: "descripcionEnCarta", data_type: "text", is_nullable: "YES", column_default: null });
  });

  it("(b) como motor2_app (con la empresa de la sesión): se escribe la descripción, se cambia y se vacía (vuelve a NULL)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await comoAppConRollback(async (c) => {
      expect((await c.query(`UPDATE "OpcionDeGrupo" SET "descripcionEnCarta" = 'lechuga, tomate, cebolla' WHERE "id" = 'opcion-vieja'`)).rowCount).toBe(1);
      expect((await c.query(`SELECT "descripcionEnCarta" FROM "OpcionDeGrupo" WHERE "id" = 'opcion-vieja'`)).rows[0]).toEqual({ descripcionEnCarta: "lechuga, tomate, cebolla" });
      expect((await c.query(`UPDATE "OpcionDeGrupo" SET "descripcionEnCarta" = NULL WHERE "id" = 'opcion-vieja'`)).rowCount).toBe(1);
      expect((await c.query(`SELECT "descripcionEnCarta" FROM "OpcionDeGrupo" WHERE "id" = 'opcion-vieja'`)).rows[0]).toEqual({ descripcionEnCarta: null });
    });
  });

  it("(c) el CHECK: 121 caracteres, solo espacios, vacío, espacios a los costados y un salto de línea adentro dan 23514; hasta 120 (con tildes y otros alfabetos) pasan", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const malo of ["x".repeat(121), "  ", "", " tomate", "tomate ", "\tcebolla", "lechuga,\ntomate", "lechuga,\r\ntomate", "lechuga\rtomate"]) {
      await comoAppConRollback(async (c) => {
        await expect(c.query(`UPDATE "OpcionDeGrupo" SET "descripcionEnCarta" = $1 WHERE "id" = 'opcion-vieja'`, [malo]), JSON.stringify(malo)).rejects.toMatchObject({ code: "23514", constraint: "OpcionDeGrupo_descripcion_en_carta_chk" });
      });
    }
    for (const bueno of ["x".repeat(120), "x", "lechuga, tomate, cebolla", "Ñandú, más y ají", "tomate · albahaca · ajo"]) {
      await comoAppConRollback(async (c) => {
        expect((await c.query(`UPDATE "OpcionDeGrupo" SET "descripcionEnCarta" = $1 WHERE "id" = 'opcion-vieja'`, [bueno])).rowCount, bueno).toBe(1);
      });
    }
  });

  it("(d) motor2_app puede actualizar EXACTAMENTE las columnas de GO-1b más la descripción; sin políticas ni privilegios de tabla nuevos", async () => {
    const despues = (await fotoDeLaOpcion()) as Record<string, unknown[]>;
    const antes = fotoAntes as Record<string, unknown[]>;
    expect(despues.politicas).toEqual(antes.politicas);
    expect(despues.privilegios).toEqual(antes.privilegios);
    expect(despues.restricciones.length).toBe(antes.restricciones.length + 1);
    if (hayRol) expect(await actualizables()).toEqual(["activa", "actualizadoEn", "descripcionEnCarta", "nombre", "orden", "version"]);
  });

  it("(e) el down.sql ABORTA si hay una descripción cargada, sin tocar nada", async () => {
    await base.cliente.query(`UPDATE "OpcionDeGrupo" SET "descripcionEnCarta" = 'lechuga, tomate, cebolla' WHERE "id" = 'opcion-vieja'`);
    const arriba = await fotoDeLaOpcion();
    await base.cliente.query("BEGIN");
    await expect(base.cliente.query(leer("down.sql"))).rejects.toThrow(/hay 1 opción\(es\) con descripción cargada/);
    await base.cliente.query("ROLLBACK");
    expect(await fotoDeLaOpcion()).toEqual(arriba);
    expect((await q(`SELECT "descripcionEnCarta" FROM "OpcionDeGrupo" WHERE "id" = 'opcion-vieja'`))[0]).toEqual({ descripcionEnCarta: "lechuga, tomate, cebolla" });
    await base.cliente.query(`UPDATE "OpcionDeGrupo" SET "descripcionEnCarta" = NULL WHERE "id" = 'opcion-vieja'`);
  });

  it("(f) SUBIR, BAJAR, SUBIR: el down.sql (sin descripciones) deja el catálogo y los privilegios por columna como antes, es idempotente, y volver a subir lo deja como la primera vez", async () => {
    const arriba = await fotoDeLaOpcion();
    await base.cliente.query(leer("down.sql"));
    expect(await fotoDeLaOpcion(), "bajado = antes de la migración").toEqual(fotoAntes);
    expect(await q(`SELECT "id","nombre" FROM "OpcionDeGrupo"`)).toEqual([{ id: "opcion-vieja", nombre: "Ensalada" }]);
    await base.cliente.query(leer("down.sql"));
    await base.cliente.query(leer("migration.sql"));
    expect(await fotoDeLaOpcion(), "subido otra vez = la primera subida").toEqual(arriba);
  });
});
