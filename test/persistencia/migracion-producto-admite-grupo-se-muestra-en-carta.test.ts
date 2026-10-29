import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * «Mostrar este grupo en la carta» (decisión del dueño, 2026-10-29: plato por plato) — migración 20261029120000_producto_admite_grupo_se_muestra_en_carta: `ProductoAdmiteGrupo.seMuestraEnCarta`,
 * BOOLEAN NOT NULL DEFAULT true, y su GRANT de UPDATE POR COLUMNA para `motor2_app` (la tabla tiene privilegios por columna desde GO-1b: sin el GRANT, el formulario del producto da 42501). Sobre una
 * base temporal armada migración por migración, con la admisión de un grupo CARGADA ANTES de la migración, en dos empresas.
 *
 * Qué fija: (a) la fila vieja queda en `true` («se muestra», como se ve hoy) y todo lo demás intacto; (b) como motor2_app (RLS por empresa puesta) se apaga y se vuelve a prender, no admite NULL, y con la
 * empresa de OTRA no toca ninguna fila (0 filas); (c) las columnas actualizables por motor2_app son las de GO-1b/GO-3a más la nueva, sin políticas ni restricciones nuevas; (d) el down.sql ABORTA si
 * hay un grupo apagado, sin tocar nada; (e) subir, bajar y subir deja el catálogo (y los privilegios por columna) idéntico, sin perder filas; (f) el migration.sql y el down.sql avisan que requieren autorización.
 *
 * Mutaciones: sacar el GRANT rompe (b) (42501) y (c); `DEFAULT false` rompe (a); borrar el `RAISE` del down.sql rompe (d).
 */
const NOMBRE = "20261029120000_producto_admite_grupo_se_muestra_en_carta";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const E1 = "emp-se-muestra-1";
const E2 = "emp-se-muestra-2";

let base: BaseTemporalMigrada;
let hayRol = false;
let app: Client | null = null;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function fotoDeLaAdmision() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ProductoAdmiteGrupo' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"ProductoAdmiteGrupo"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'ProductoAdmiteGrupo' ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'ProductoAdmiteGrupo' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`),
    privilegiosPorColumna: await q(`SELECT grantee::text AS rol, column_name::text AS columna, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = 'ProductoAdmiteGrupo' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ProductoAdmiteGrupo' ORDER BY 1`),
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

/** Corre `consulta` como `motor2_app` en una transacción con la empresa dada puesta y SIEMPRE hace ROLLBACK. */
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

const actualizables = async () =>
  (await q<{ columna: string }>(
    `SELECT a.attname::text AS columna FROM pg_attribute a WHERE a.attrelid = '"ProductoAdmiteGrupo"'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege('motor2_app', a.attrelid, a.attnum, 'UPDATE') ORDER BY 1`,
  )).map((c) => c.columna);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  await base.aplicarAntesDe(NOMBRE);
  for (const e of [E1, E2]) {
    await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
    await base.cliente.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud","decimales") VALUES ($2,$1,'u','CANTIDAD',0)`, [e, `u-${e}`]);
    await base.cliente.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ($2,$1,'BIFE','Bife','PV',$3,20000)`, [e, `bife-${e}`, `u-${e}`]);
    await base.cliente.query(`INSERT INTO "GrupoDeOpciones" ("id","empresaId","nombre","tipo","cantidadMinima","cantidadMaxima") VALUES ($2,$1,'Corte','VARIANTE',1,1)`, [e, `corte-${e}`]);
    await base.cliente.query(`INSERT INTO "ProductoAdmiteGrupo" ("id","empresaId","productoId","grupoId","orden") VALUES ($2,$1,$3,$4,2)`, [e, `admite-${e}`, `bife-${e}`, `corte-${e}`]);
  }
  fotoAntes = await fotoDeLaAdmision();
}, 120_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await base?.eliminar();
}, 60_000);

describe("«Mostrar este grupo en la carta» de la admisión del grupo (migración 20261029120000)", () => {
  it("(a) al aplicar, la fila vieja queda en true («se muestra») y lo demás sin cambios; la columna es BOOLEAN NOT NULL DEFAULT true, al final de la tabla", async () => {
    const antes = await q(`SELECT * FROM "ProductoAdmiteGrupo" ORDER BY "id"`);
    await base.cliente.query(leer("migration.sql"));
    const despues = (await q(`SELECT * FROM "ProductoAdmiteGrupo" ORDER BY "id"`)) as Record<string, unknown>[];
    expect(despues.map((f) => f.seMuestraEnCarta)).toEqual([true, true]);
    expect(despues.map((f) => Object.fromEntries(Object.entries(f).filter(([c]) => c !== "seMuestraEnCarta"))), "ninguna otra columna cambió").toEqual(antes);
    const columnas = (await fotoDeLaAdmision()).columnas as { columna: string }[];
    expect(columnas.at(-1)).toEqual({ columna: "seMuestraEnCarta", data_type: "boolean", is_nullable: "NO", column_default: "true" });
  });

  it("(b) como motor2_app (con la empresa de la sesión): se apaga y se vuelve a prender, no admite NULL, y con la empresa de OTRA no toca ninguna fila", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await comoAppConRollback(E1, async (c) => {
      expect((await c.query(`UPDATE "ProductoAdmiteGrupo" SET "seMuestraEnCarta" = false WHERE "grupoId" = $1`, [`corte-${E1}`])).rowCount).toBe(1);
      expect((await c.query(`SELECT "id", "seMuestraEnCarta" FROM "ProductoAdmiteGrupo"`)).rows, "solo ve la suya").toEqual([{ id: `admite-${E1}`, seMuestraEnCarta: false }]);
      expect((await c.query(`UPDATE "ProductoAdmiteGrupo" SET "seMuestraEnCarta" = true WHERE "id" = $1`, [`admite-${E1}`])).rowCount).toBe(1);
      await expect(c.query(`UPDATE "ProductoAdmiteGrupo" SET "seMuestraEnCarta" = NULL WHERE "id" = $1`, [`admite-${E1}`])).rejects.toMatchObject({ code: "23502" });
    });
    await comoAppConRollback(E2, async (c) => {
      expect((await c.query(`UPDATE "ProductoAdmiteGrupo" SET "seMuestraEnCarta" = false WHERE "id" = $1`, [`admite-${E1}`])).rowCount, "la fila de otra empresa no se toca").toBe(0);
    });
    expect((await q(`SELECT "seMuestraEnCarta" FROM "ProductoAdmiteGrupo" ORDER BY "id"`)).map((f) => (f as { seMuestraEnCarta: boolean }).seMuestraEnCarta)).toEqual([true, true]);
  });

  it("(c) motor2_app puede actualizar EXACTAMENTE las columnas de GO-1b y GO-3a más la nueva; sin políticas ni restricciones nuevas", async () => {
    const despues = (await fotoDeLaAdmision()) as Record<string, unknown[]>;
    const antes = fotoAntes as Record<string, unknown[]>;
    for (const k of ["restricciones", "indices", "privilegios", "politicas"]) expect(despues[k], k).toEqual(antes[k]);
    if (hayRol) expect(await actualizables()).toEqual(["activo", "actualizadoEn", "cantidadMaxima", "cantidadMinima", "ejeDeCombinacion", "modoPrecio", "orden", "seMuestraEnCarta", "version"]);
  });

  it("(d) el down.sql ABORTA si hay un grupo apagado, sin tocar nada", async () => {
    await base.cliente.query(`UPDATE "ProductoAdmiteGrupo" SET "seMuestraEnCarta" = false WHERE "id" = $1`, [`admite-${E2}`]);
    const arriba = await fotoDeLaAdmision();
    await base.cliente.query("BEGIN");
    await expect(base.cliente.query(leer("down.sql"))).rejects.toThrow(/hay 1 grupo\(s\) de producto apagados en la carta/);
    await base.cliente.query("ROLLBACK");
    expect(await fotoDeLaAdmision()).toEqual(arriba);
    expect((await q(`SELECT "seMuestraEnCarta" FROM "ProductoAdmiteGrupo" WHERE "id" = $1`, [`admite-${E2}`]))[0]).toEqual({ seMuestraEnCarta: false });
    await base.cliente.query(`UPDATE "ProductoAdmiteGrupo" SET "seMuestraEnCarta" = true WHERE "id" = $1`, [`admite-${E2}`]);
  });

  it("(e) SUBIR, BAJAR, SUBIR: el down.sql deja el catálogo y los privilegios por columna como antes (sin perder filas), es idempotente, y volver a subir lo deja como la primera vez", async () => {
    const arriba = await fotoDeLaAdmision();
    await base.cliente.query(leer("down.sql"));
    expect(await fotoDeLaAdmision(), "bajado = antes de la migración").toEqual(fotoAntes);
    expect(await q(`SELECT "id", "orden" FROM "ProductoAdmiteGrupo" ORDER BY "id"`)).toEqual([
      { id: `admite-${E1}`, orden: 2 },
      { id: `admite-${E2}`, orden: 2 },
    ]);
    await base.cliente.query(leer("down.sql"));
    await base.cliente.query(leer("migration.sql"));
    expect(await fotoDeLaAdmision(), "subido otra vez = la primera subida").toEqual(arriba);
  });

  it("(f) el migration.sql y el down.sql avisan que requieren autorización y que la reversa aborta con filas apagadas", () => {
    expect(leer("migration.sql").split("\n")[0]).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(leer("down.sql")).toMatch(/ABORTA/);
    expect(leer("down.sql")).toMatch(/RAISE EXCEPTION/);
  });
});
