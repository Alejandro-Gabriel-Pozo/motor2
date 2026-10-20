import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODOS_DE_VENTA } from "../../src/core/opciones/tipos";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Fase 4 de la ola «precio y carta», C1 — migración 20261021130000_producto_modo_de_venta: `Producto.modoDeVenta`, TEXT NOT NULL DEFAULT 'DIRECTO' de lista cerrada (CHECK), y el CHECK de que
 * solo un PV que no se produce puede ser base. Se corre sobre una base temporal armada migración por migración, con un producto CARGADO ANTES de la migración (el estado de hoy de una instalación).
 *
 * Qué fija: (a) el producto viejo queda DIRECTO y todo lo demás intacto; (b) el CHECK de lista rechaza un modo inventado (23514) y el de base rechaza una MP y un PV que se produce, con el rol real
 * de la app; (c) la lista del CHECK es EXACTAMENTE `MODOS_DE_VENTA`; (e) actualizar el producto viejo sin mencionar el modo sigue andando; (f) sin privilegios ni políticas nuevas; (d) subir, bajar y
 * subir deja el catálogo idéntico; (g) el down.sql ABORTA (sin tocar nada) si hay una base cargada.
 *
 * Mutaciones: sacar 'BASE_CONFIGURABLE' del CHECK rompe (b) y (c); sacar el CHECK de PV rompe (b); borrar el `RAISE` del down.sql rompe (g).
 */
const NOMBRE = "20261021130000_producto_modo_de_venta";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const E = "emp-modo";

let base: BaseTemporalMigrada;
let hayRol = false;
let app: Client | null = null;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

/** Columnas, restricciones, índices y privilegios de `Producto`: lo que la migración puede tocar. */
async function fotoDeProducto() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Producto' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"Producto"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Producto' ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'Producto' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2`),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Producto' ORDER BY 1`),
  };
}

/** Una conexión como `motor2_app` (el rol real de la app, sujeto a RLS) a la base temporal. */
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

/** Corre `consulta` como `motor2_app` en una transacción con la empresa puesta y SIEMPRE hace ROLLBACK: no deja nada escrito. */
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

const insertar = (c: Client, id: string, tipo: "PV" | "MP", seProduce: boolean, modo: string) =>
  c.query(`INSERT INTO "Producto" ("id","codigo","nombre","tipo","unidadStockId","seProduce","modoDeVenta") VALUES ($1,$1,$1,$2,'u-modo',$3,$4)`, [id, tipo, seProduce, modo]);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  await base.aplicarAntesDe(NOMBRE);
  await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await base.cliente.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('u-modo',$1,'unidad','CANTIDAD')`, [E]);
  await base.cliente.query(
    `INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta","observaciones") VALUES ('prod-viejo',$1,'PV-VIEJO','Pizzas','PV','u-modo',18000,'cargado antes')`,
    [E],
  );
  if (hayRol) await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "Producto" TO motor2_app`); // en una base temporal los privilegios del rol no vienen de las migraciones
  fotoAntes = await fotoDeProducto();
}, 120_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await base?.eliminar();
}, 60_000);

describe("Fase 4, C1: modo de venta del producto (migración 20261021130000)", () => {
  it("(a) al aplicar, el producto viejo queda DIRECTO y lo demás sin cambios; la tabla gana exactamente esa columna, TEXT NOT NULL con default 'DIRECTO'", async () => {
    const antes = (await q(`SELECT * FROM "Producto" WHERE "id" = 'prod-viejo'`))[0];
    await base.cliente.query(leer("migration.sql"));
    const despues = (await q(`SELECT * FROM "Producto" WHERE "id" = 'prod-viejo'`))[0] as Record<string, unknown>;
    expect(despues.modoDeVenta, "lo que ya hacía: tiene su precio").toBe("DIRECTO");
    const resto = Object.fromEntries(Object.entries(despues).filter(([columna]) => columna !== "modoDeVenta"));
    expect(resto, "ninguna otra columna cambió").toEqual(antes);
    expect(await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Producto' AND column_name = 'modoDeVenta'`)).toEqual([
      { columna: "modoDeVenta", data_type: "text", is_nullable: "NO", column_default: "'DIRECTO'::text" },
    ]);
    expect(await q(`SELECT 1 FROM "Producto" WHERE "modoDeVenta" <> 'DIRECTO'`), "ninguna fila existente pasa a base").toEqual([]);
  });

  it("(b) como motor2_app: un modo inventado da 23514 (lista), una MP o un PV que se produce como base da 23514 (base), y un PV que no se produce puede ser base", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const [tipo, seProduce, modo, restriccion] of [
      ["PV", false, "BASE", "Producto_modoDeVenta_check"],
      ["PV", false, "directo", "Producto_modoDeVenta_check"], // minúsculas: no es el código
      ["PV", false, "", "Producto_modoDeVenta_check"],
      ["MP", false, "BASE_CONFIGURABLE", "Producto_modoDeVenta_base_check"],
      ["MP", true, "BASE_CONFIGURABLE", "Producto_modoDeVenta_base_check"],
      ["PV", true, "BASE_CONFIGURABLE", "Producto_modoDeVenta_base_check"],
    ] as const) {
      await comoAppConRollback(async (c) => {
        await expect(insertar(c, "prod-malo", tipo, seProduce, modo), `${tipo}/${seProduce}/${modo}`).rejects.toMatchObject({ code: "23514", constraint: restriccion });
      });
    }
    await comoAppConRollback(async (c) => {
      await insertar(c, "prod-base", "PV", false, "BASE_CONFIGURABLE");
      await insertar(c, "prod-mp", "MP", true, "DIRECTO");
      expect((await c.query(`SELECT "id", "modoDeVenta" FROM "Producto" WHERE "id" IN ('prod-base','prod-mp') ORDER BY 1`)).rows).toEqual([
        { id: "prod-base", modoDeVenta: "BASE_CONFIGURABLE" },
        { id: "prod-mp", modoDeVenta: "DIRECTO" },
      ]);
    });
  });

  it("(b2) los CHECK también frenan una ACTUALIZACIÓN: tildar «se produce» en una base, o pasar a base un PV que se produce", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await comoAppConRollback(async (c) => {
      await c.query(`UPDATE "Producto" SET "modoDeVenta" = 'BASE_CONFIGURABLE' WHERE "id" = 'prod-viejo'`);
      await expect(c.query(`UPDATE "Producto" SET "seProduce" = true WHERE "id" = 'prod-viejo'`)).rejects.toMatchObject({ code: "23514", constraint: "Producto_modoDeVenta_base_check" });
    });
    await comoAppConRollback(async (c) => {
      await c.query(`UPDATE "Producto" SET "seProduce" = true WHERE "id" = 'prod-viejo'`);
      await expect(c.query(`UPDATE "Producto" SET "modoDeVenta" = 'BASE_CONFIGURABLE' WHERE "id" = 'prod-viejo'`)).rejects.toMatchObject({ code: "23514", constraint: "Producto_modoDeVenta_base_check" });
    });
  });

  it("(c) paridad: la lista del CHECK de la base es EXACTAMENTE MODOS_DE_VENTA, y el de base nombra PV y «se produce»", async () => {
    const [lista] = await q<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = '"Producto"'::regclass AND conname = 'Producto_modoDeVenta_check'`);
    expect(lista).toBeDefined();
    const valores = [...lista!.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
    expect([...valores].sort()).toEqual([...MODOS_DE_VENTA].sort());
    expect(new Set(valores).size).toBe(valores.length);
    const [deBase] = await q<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = '"Producto"'::regclass AND conname = 'Producto_modoDeVenta_base_check'`);
    expect(deBase!.def).toContain("'DIRECTO'::text");
    expect(deBase!.def).toContain("'PV'::\"TipoProducto\"");
    expect(deBase!.def).toContain('NOT "seProduce"');
    expect(await q(`SELECT conname FROM pg_constraint WHERE conrelid = '"Producto"'::regclass AND NOT convalidated`), "ninguna restricción NOT VALID").toEqual([]);
  });

  it("(e) actualizar el producto viejo SIN mencionar el modo (como el formulario de hoy) sigue pasando y lo deja DIRECTO", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await comoAppConRollback(async (c) => {
      const r = await c.query(`UPDATE "Producto" SET "nombre" = 'Pizzas a la piedra', "precioVenta" = 19000 WHERE "id" = 'prod-viejo'`);
      expect(r.rowCount).toBe(1);
      expect((await c.query(`SELECT "modoDeVenta" FROM "Producto" WHERE "id" = 'prod-viejo'`)).rows[0]).toEqual({ modoDeVenta: "DIRECTO" });
    });
  });

  it("(f) sin privilegios nuevos ni políticas nuevas: la migración solo agrega la columna y los dos CHECK, sin ACL propia en la columna", async () => {
    const despues = (await fotoDeProducto()) as Record<string, unknown[]>;
    const antes = fotoAntes as Record<string, unknown[]>;
    expect(despues.politicas, "las mismas políticas de RLS").toEqual(antes.politicas);
    expect(despues.indices, "los mismos índices").toEqual(antes.indices);
    expect(despues.privilegios, "los mismos privilegios de tabla").toEqual(antes.privilegios);
    expect(despues.restricciones.length, "dos restricciones más").toBe(antes.restricciones.length + 2);
    expect(despues.columnas.length, "una columna más").toBe(antes.columnas.length + 1);
    expect(await q(`SELECT attname::text AS columna, attacl::text AS acl FROM pg_attribute WHERE attrelid = '"Producto"'::regclass AND attname = 'modoDeVenta'`)).toEqual([{ columna: "modoDeVenta", acl: null }]);
  });

  it("(g) el down.sql ABORTA si hay una base cargada, sin tocar nada (la columna, los CHECK y el valor siguen)", async () => {
    await base.cliente.query(`UPDATE "Producto" SET "modoDeVenta" = 'BASE_CONFIGURABLE' WHERE "id" = 'prod-viejo'`);
    const arriba = await fotoDeProducto();
    await base.cliente.query("BEGIN");
    await expect(base.cliente.query(leer("down.sql"))).rejects.toThrow(/hay 1 producto\(s\) que se venden por opción/);
    await base.cliente.query("ROLLBACK");
    expect(await fotoDeProducto(), "nada cambió").toEqual(arriba);
    expect(await q(`SELECT "modoDeVenta" FROM "Producto" WHERE "id" = 'prod-viejo'`)).toEqual([{ modoDeVenta: "BASE_CONFIGURABLE" }]);
    await base.cliente.query(`UPDATE "Producto" SET "modoDeVenta" = 'DIRECTO' WHERE "id" = 'prod-viejo'`);
  });

  it("(d) SUBIR, BAJAR, SUBIR: el down.sql deja el catálogo como antes (con la fila vieja intacta) y volver a subir lo deja como la primera vez", async () => {
    const arriba = await fotoDeProducto();
    await base.cliente.query(leer("down.sql"));
    expect(await fotoDeProducto(), "bajado = antes de la migración").toEqual(fotoAntes);
    expect((await q(`SELECT "id","nombre","precioVenta"::text AS precio FROM "Producto" WHERE "id" = 'prod-viejo'`))[0], "los datos de antes siguen").toEqual({ id: "prod-viejo", nombre: "Pizzas", precio: "18000.00" });
    await base.cliente.query(leer("down.sql")); // idempotente (IF EXISTS, y el bloque de guarda mira si la columna existe)
    await base.cliente.query(leer("migration.sql"));
    expect(await fotoDeProducto(), "subido otra vez = la primera subida").toEqual(arriba);
  });
});
