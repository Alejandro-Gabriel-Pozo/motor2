import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Fase 5 de la ola «precio y carta» («carta pareja», DEC-11) — migración 20261021140000_contenido_carta_mostrar_nombre_arriba: `ContenidoCartaProducto.mostrarNombreArriba`, BOOLEAN NOT NULL DEFAULT
 * false (el interruptor «Mostrar el nombre arriba» de un producto base con un solo eje). Sobre una base temporal armada migración por migración, con un contenido de carta CARGADO ANTES de la migración.
 *
 * Qué fija: (a) el contenido viejo queda en `false` (la base oculta, el default del dueño) y todo lo demás intacto; (b) como motor2_app, con la empresa y la sucursal de la sesión (RLS por empresa y por
 * sucursal), se prende y se apaga, y en una sucursal fuera del alcance no se toca nada (0 filas); (c) sin políticas, restricciones ni privilegios nuevos (la tabla tiene privilegios de TABLA); (d) el
 * down.sql ABORTA si hay alguno prendido, sin tocar nada; (e) subir, bajar y subir deja el catálogo idéntico, y bajar dos veces no falla.
 *
 * Mutaciones: borrar el `RAISE` del down.sql rompe (d); `DEFAULT true` rompe (a).
 */
const NOMBRE = "20261021140000_contenido_carta_mostrar_nombre_arriba";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const E = "emp-nombre-arriba";

let base: BaseTemporalMigrada;
let hayRol = false;
let app: Client | null = null;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function fotoDelContenido() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ContenidoCartaProducto' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"ContenidoCartaProducto"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'ContenidoCartaProducto' ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'ContenidoCartaProducto' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`),
    privilegiosPorColumna: await q(`SELECT grantee::text AS rol, column_name::text AS columna, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = 'ContenidoCartaProducto' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ContenidoCartaProducto' ORDER BY 1`),
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

/** Corre `consulta` como `motor2_app` en una transacción con la empresa y el alcance de escritura de `sucursal`, y SIEMPRE hace ROLLBACK. */
async function comoAppConRollback<T>(sucursal: string, consulta: (c: Client) => Promise<T>): Promise<T> {
  app ??= await conectarComoApp();
  await app.query("BEGIN");
  try {
    await app.query("SELECT set_config('app.empresa_id', $1, true), set_config('app.sucursales_escritura', $2, true)", [E, sucursal]);
    return await consulta(app);
  } finally {
    await app.query("ROLLBACK");
  }
}

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  await base.aplicarAntesDe(NOMBRE);
  await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await base.cliente.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud","decimales") VALUES ('u',$1,'u','CANTIDAD',0)`, [E]);
  for (const s of ["central", "norte"]) await base.cliente.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ($2,$1,$2)`, [E, s]);
  await base.cliente.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('pizzas',$1,'PZ','Pizzas','PV','u',18000)`, [E]);
  for (const s of ["central", "norte"]) {
    await base.cliente.query(
      `INSERT INTO "ContenidoCartaProducto" ("id","empresaId","sucursalId","productoId","visibleEnCarta","descripcion","tags","especial","orden","actualizadoEn") VALUES ($2,$1,$3,'pizzas',true,'A la piedra','{Regional}',true,3,'2026-10-20T12:00:00Z')`,
      [E, `contenido-${s}`, s]
    );
  }
  // En una base temporal los privilegios de TABLA del rol no vienen de las migraciones (los da `scripts/operaciones/crear-rol-motor2-app.sql`): se le dan a mano, ANTES de la foto.
  if (hayRol) await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "ContenidoCartaProducto" TO motor2_app`);
  fotoAntes = await fotoDelContenido();
}, 120_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await base?.eliminar();
}, 60_000);

describe("Fase 5, DEC-11: «Mostrar el nombre arriba» del contenido de carta (migración 20261021140000)", () => {
  it("(a) al aplicar, el contenido viejo queda en false (la base oculta) y lo demás sin cambios; la columna es BOOLEAN NOT NULL DEFAULT false, al final de la tabla", async () => {
    const antes = await q(`SELECT * FROM "ContenidoCartaProducto" ORDER BY "id"`);
    await base.cliente.query(leer("migration.sql"));
    const despues = (await q(`SELECT * FROM "ContenidoCartaProducto" ORDER BY "id"`)) as Record<string, unknown>[];
    expect(despues.map((f) => f.mostrarNombreArriba)).toEqual([false, false]);
    expect(despues.map((f) => Object.fromEntries(Object.entries(f).filter(([c]) => c !== "mostrarNombreArriba"))), "ninguna otra columna cambió").toEqual(antes);
    const columnas = (await fotoDelContenido()).columnas as { columna: string }[];
    expect(columnas.at(-1)).toEqual({ columna: "mostrarNombreArriba", data_type: "boolean", is_nullable: "NO", column_default: "false" });
  });

  it("(b) como motor2_app: se prende y se apaga en la sucursal de la sesión; la de otra sucursal no se toca (RLS por sucursal)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await comoAppConRollback("central", async (c) => {
      expect((await c.query(`UPDATE "ContenidoCartaProducto" SET "mostrarNombreArriba" = true WHERE "productoId" = 'pizzas'`)).rowCount, "solo la fila de central").toBe(1);
      expect((await c.query(`SELECT "sucursalId", "mostrarNombreArriba" FROM "ContenidoCartaProducto"`)).rows).toEqual([{ sucursalId: "central", mostrarNombreArriba: true }]);
      expect((await c.query(`UPDATE "ContenidoCartaProducto" SET "mostrarNombreArriba" = false WHERE "id" = 'contenido-central'`)).rowCount).toBe(1);
      await expect(c.query(`UPDATE "ContenidoCartaProducto" SET "mostrarNombreArriba" = NULL WHERE "id" = 'contenido-central'`)).rejects.toMatchObject({ code: "23502" });
    });
  });

  it("(c) sin políticas, restricciones, índices ni privilegios nuevos: la tabla tiene privilegios de TABLA, que cubren la columna", async () => {
    const despues = (await fotoDelContenido()) as Record<string, unknown[]>;
    const antes = fotoAntes as Record<string, unknown[]>;
    for (const k of ["restricciones", "indices", "privilegios", "politicas"]) expect(despues[k], k).toEqual(antes[k]);
    // Sin privilegios por columna: los de la columna nueva son los mismos de tabla (si alguien agregara un GRANT por columna, cambiaría acá).
    expect((despues.privilegiosPorColumna as { columna: string }[]).filter((p) => p.columna !== "mostrarNombreArriba")).toEqual(antes.privilegiosPorColumna);
  });

  it("(d) el down.sql ABORTA si hay alguno prendido, sin tocar nada", async () => {
    await base.cliente.query(`UPDATE "ContenidoCartaProducto" SET "mostrarNombreArriba" = true WHERE "id" = 'contenido-norte'`);
    const arriba = await fotoDelContenido();
    await base.cliente.query("BEGIN");
    await expect(base.cliente.query(leer("down.sql"))).rejects.toThrow(/hay 1 producto\(s\) con «Mostrar el nombre arriba» prendido/);
    await base.cliente.query("ROLLBACK");
    expect(await fotoDelContenido()).toEqual(arriba);
    expect((await q(`SELECT "mostrarNombreArriba" FROM "ContenidoCartaProducto" WHERE "id" = 'contenido-norte'`))[0]).toEqual({ mostrarNombreArriba: true });
    await base.cliente.query(`UPDATE "ContenidoCartaProducto" SET "mostrarNombreArriba" = false WHERE "id" = 'contenido-norte'`);
  });

  it("(e) SUBIR, BAJAR, SUBIR: el down.sql deja el catálogo como antes (sin perder filas), es idempotente, y volver a subir lo deja como la primera vez", async () => {
    const arriba = await fotoDelContenido();
    await base.cliente.query(leer("down.sql"));
    expect(await fotoDelContenido(), "bajado = antes de la migración").toEqual(fotoAntes);
    expect(await q(`SELECT "id", "descripcion", "especial", "orden" FROM "ContenidoCartaProducto" ORDER BY "id"`)).toEqual([
      { id: "contenido-central", descripcion: "A la piedra", especial: true, orden: 3 },
      { id: "contenido-norte", descripcion: "A la piedra", especial: true, orden: 3 },
    ]);
    await base.cliente.query(leer("down.sql"));
    await base.cliente.query(leer("migration.sql"));
    expect(await fotoDelContenido(), "subido otra vez = la primera subida").toEqual(arriba);
  });
});
