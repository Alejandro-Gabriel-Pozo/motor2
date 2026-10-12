import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALICUOTAS_IVA } from "../../src/core/fiscal/iva";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * M0-IVA (Paquete 2, fase EXPANDIR) — migración 20261015100000_m0_iva_alicuotas_de_producto: `Producto.alicuotaIvaVenta` y `Producto.alicuotaIvaCompra`, TEXT NULL de lista
 * cerrada (CHECK). Se corre sobre una base temporal armada migración por migración, con un producto CARGADO ANTES de la migración (el estado de hoy de una instalación).
 *
 * Qué fija: (a) el producto viejo queda con las dos columnas en NULL y todo lo demás intacto; (b) el CHECK rechaza un código inventado (23514) y acepta los de la lista, con el
 * rol real de la app; (c) la lista del CHECK es EXACTAMENTE `ALICUOTAS_IVA`; (d) subir, bajar y subir deja el catálogo idéntico; (e) actualizar el producto viejo SIN mencionar la
 * alícuota (como hace el formulario de hoy) sigue andando: no hay obligatoriedad, ni siquiera NOT VALID.
 *
 * Mutaciones: sumar 'IVA_99' a la lista de TS rompe (c); sacar un CHECK del SQL rompe (b) y (c); sacar un DROP COLUMN del down.sql rompe (d); poner NOT NULL o un CHECK de
 * obligatoriedad rompe (a) y (e).
 */
const NOMBRE = "20261015100000_m0_iva_alicuotas_de_producto";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const E = "emp-iva";

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
    privilegiosPorColumna: await q(`SELECT grantee::text AS rol, column_name::text AS columna, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = 'Producto' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'Producto' ORDER BY 1`),
  };
}

/** Una conexión como `motor2_app` (el rol real de la app, sujeto a RLS) a la base temporal, con la empresa de la sesión puesta. */
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

const insertar = (c: Client, id: string, venta: string | null, compra: string | null) =>
  c.query(`INSERT INTO "Producto" ("id","codigo","nombre","tipo","unidadStockId","alicuotaIvaVenta","alicuotaIvaCompra") VALUES ($1,$1,$1,'PV','u-iva',$2,$3)`, [id, venta, compra]);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  hayRol = (await base.cliente.query("SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app'")).rowCount === 1;
  await base.aplicarAntesDe(NOMBRE);
  await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await base.cliente.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('u-iva',$1,'unidad','CANTIDAD')`, [E]);
  await base.cliente.query(
    `INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta","observaciones") VALUES ('prod-viejo',$1,'PV-VIEJO','Milanesa','PV','u-iva',1500.50,'cargado antes')`,
    [E],
  );
  if (hayRol) await base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "Producto" TO motor2_app`); // en una base temporal los privilegios del rol no vienen de las migraciones
  fotoAntes = await fotoDeProducto();
}, 120_000);

afterAll(async () => {
  await app?.end().catch(() => undefined);
  await base?.eliminar();
}, 60_000);

describe("M0-IVA: alícuotas de IVA del producto (migración 20261015100000)", () => {
  it("(a) al aplicar, el producto viejo queda con las dos alícuotas en NULL y lo demás sin cambios; la tabla gana exactamente esas dos columnas", async () => {
    const antes = (await q(`SELECT * FROM "Producto" WHERE "id" = 'prod-viejo'`))[0];
    await base.cliente.query(leer("migration.sql"));
    const despues = (await q(`SELECT * FROM "Producto" WHERE "id" = 'prod-viejo'`))[0] as Record<string, unknown>;
    expect(despues.alicuotaIvaVenta, "sin valor deducido").toBeNull();
    expect(despues.alicuotaIvaCompra, "sin valor deducido").toBeNull();
    const resto = Object.fromEntries(Object.entries(despues).filter(([columna]) => !columna.startsWith("alicuotaIva")));
    expect(resto, "ninguna otra columna cambió").toEqual(antes);
    const columnas = await q<{ columna: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Producto' AND column_name LIKE 'alicuotaIva%' ORDER BY 1`,
    );
    expect(columnas).toEqual([
      { columna: "alicuotaIvaCompra", data_type: "text", is_nullable: "YES", column_default: null },
      { columna: "alicuotaIvaVenta", data_type: "text", is_nullable: "YES", column_default: null },
    ]);
  });

  it("(a2) no hay ningún valor por defecto ni backfill: todas las filas que ya había siguen en NULL", async () => {
    expect(await q(`SELECT 1 FROM "Producto" WHERE "alicuotaIvaVenta" IS NOT NULL OR "alicuotaIvaCompra" IS NOT NULL`)).toEqual([]);
  });

  it("(b) como motor2_app, un código fuera de la lista da 23514 (en cada columna) y los de la lista pasan", async (ctx) => {
    if (!hayRol) return ctx.skip();
    for (const [venta, compra, columna] of [
      ["IVA_22", null, "Producto_alicuotaIvaVenta_check"],
      [null, "IVA_22", "Producto_alicuotaIvaCompra_check"],
      ["iva_21", null, "Producto_alicuotaIvaVenta_check"], // minúsculas: no es el código
      ["", null, "Producto_alicuotaIvaVenta_check"], // vacío no es «sin declarar» (eso es NULL)
      ["NO_CORRESPONDE", null, "Producto_alicuotaIvaVenta_check"], // la efectiva de una venta, no del producto
    ] as const) {
      await comoAppConRollback(async (c) => {
        await expect(insertar(c, "prod-malo", venta, compra), `${venta ?? "NULL"}/${compra ?? "NULL"}`).rejects.toMatchObject({ code: "23514", constraint: columna });
      });
    }
    await comoAppConRollback(async (c) => {
      for (const [i, codigo] of ALICUOTAS_IVA.entries()) await insertar(c, `prod-ok-${i}`, codigo, codigo);
      await insertar(c, "prod-null", null, null);
      expect((await c.query(`SELECT count(*)::int AS n FROM "Producto" WHERE "id" LIKE 'prod-ok-%'`)).rows[0].n).toBe(ALICUOTAS_IVA.length);
    });
  });

  it("(b2) el CHECK también frena una ACTUALIZACIÓN con un código inventado (no solo el alta)", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await comoAppConRollback(async (c) => {
      await expect(c.query(`UPDATE "Producto" SET "alicuotaIvaVenta" = 'IVA_22' WHERE "id" = 'prod-viejo'`)).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("(c) paridad: la lista de cada CHECK de la base es EXACTAMENTE ALICUOTAS_IVA", async () => {
    for (const [columna, nombre] of [["alicuotaIvaVenta", "Producto_alicuotaIvaVenta_check"], ["alicuotaIvaCompra", "Producto_alicuotaIvaCompra_check"]] as const) {
      const [fila] = await q<{ def: string }>(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = '"Producto"'::regclass AND conname = $1`, [nombre]);
      expect(fila, nombre).toBeDefined();
      // CHECK (("alicuotaIvaVenta" IS NULL) OR ("alicuotaIvaVenta" = ANY (ARRAY['IVA_0'::text, ...])))
      const lista = [...fila!.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
      expect([...lista].sort(), `${nombre}: los códigos del CHECK`).toEqual([...ALICUOTAS_IVA].sort());
      expect(new Set(lista).size, `${nombre}: sin repetidos`).toBe(lista.length);
      expect(fila!.def, nombre).toContain(`"${columna}" IS NULL`);
    }
  });

  it("(e) actualizar el producto viejo SIN mencionar la alícuota (como el formulario de hoy) sigue pasando: no hay obligatoriedad", async (ctx) => {
    if (!hayRol) return ctx.skip();
    await comoAppConRollback(async (c) => {
      const r = await c.query(`UPDATE "Producto" SET "nombre" = 'Milanesa napolitana', "precioVenta" = 1800 WHERE "id" = 'prod-viejo'`);
      expect(r.rowCount).toBe(1);
      const fila = (await c.query(`SELECT "alicuotaIvaVenta", "alicuotaIvaCompra" FROM "Producto" WHERE "id" = 'prod-viejo'`)).rows[0];
      expect(fila).toEqual({ alicuotaIvaVenta: null, alicuotaIvaCompra: null });
    });
  });

  it("(e2) ninguna restricción de obligatoriedad: las dos columnas admiten NULL y los CHECK contemplan IS NULL", async () => {
    const defs = await q<{ nombre: string; def: string }>(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = '"Producto"'::regclass AND contype = 'c' AND conname LIKE 'Producto\\_alicuotaIva%'`);
    expect(defs.map((d) => d.nombre).sort()).toEqual(["Producto_alicuotaIvaCompra_check", "Producto_alicuotaIvaVenta_check"]);
    expect(await q(`SELECT conname FROM pg_constraint WHERE conrelid = '"Producto"'::regclass AND NOT convalidated`), "ninguna restricción NOT VALID").toEqual([]);
  });

  it("(f) sin privilegios nuevos ni políticas nuevas: la migración solo agrega las dos columnas y los dos CHECK", async () => {
    const despues = (await fotoDeProducto()) as Record<string, unknown[]>;
    const antes = fotoAntes as Record<string, unknown[]>;
    expect(despues.politicas, "las mismas políticas de RLS").toEqual(antes.politicas);
    expect(despues.indices, "los mismos índices").toEqual(antes.indices);
    expect(despues.privilegios, "los mismos privilegios de tabla").toEqual(antes.privilegios);
    expect(despues.restricciones.length, "dos restricciones más").toBe(antes.restricciones.length + 2);
    expect(despues.columnas.length, "dos columnas más").toBe(antes.columnas.length + 2);
    expect(await q(`SELECT attname::text AS columna, attacl::text AS acl FROM pg_attribute WHERE attrelid = '"Producto"'::regclass AND attname LIKE 'alicuotaIva%' ORDER BY 1`), "sin ACL propia en las columnas nuevas").toEqual([
      { columna: "alicuotaIvaCompra", acl: null },
      { columna: "alicuotaIvaVenta", acl: null },
    ]);
    // Los privilegios de tabla cubren las columnas nuevas: motor2_app puede escribirlas por columna sin un GRANT nuevo.
    if (hayRol) {
      const porColumna = (despues.privilegiosPorColumna as { rol: string; columna: string; privilege_type: string }[]).filter((p) => p.rol === "motor2_app" && p.columna.startsWith("alicuotaIva"));
      expect(porColumna.map((p) => `${p.columna}:${p.privilege_type}`).sort()).toEqual([
        "alicuotaIvaCompra:INSERT", "alicuotaIvaCompra:SELECT", "alicuotaIvaCompra:UPDATE", "alicuotaIvaVenta:INSERT", "alicuotaIvaVenta:SELECT", "alicuotaIvaVenta:UPDATE",
      ]);
    }
  });

  it("(d) SUBIR, BAJAR, SUBIR: el down.sql deja el catálogo como antes (con la fila vieja intacta) y volver a subir lo deja como la primera vez", async () => {
    const arriba = await fotoDeProducto();
    await base.cliente.query(leer("down.sql"));
    expect(await fotoDeProducto(), "bajado = antes de la migración").toEqual(fotoAntes);
    const viejo = (await q(`SELECT "id","nombre","precioVenta"::text AS precio FROM "Producto" WHERE "id" = 'prod-viejo'`))[0];
    expect(viejo, "los datos de antes siguen").toEqual({ id: "prod-viejo", nombre: "Milanesa", precio: "1500.50" });
    await base.cliente.query(leer("down.sql")); // idempotente (IF EXISTS)
    await base.cliente.query(leer("migration.sql"));
    expect(await fotoDeProducto(), "subido otra vez = la primera subida").toEqual(arriba);
  });
});
