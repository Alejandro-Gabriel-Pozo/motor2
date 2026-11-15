import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Nombre de cocina (2026-11-15) — migración 20261115170000_nombre_de_cocina: `Producto.nombreDeCocina` y `CuentaItem.nombreDeCocina` (TEXT NULL, cada una con un CHECK: NULL, o de 1 a 80 caracteres sin espacios en los
 * bordes ni saltos de línea; en el producto, además, solo un PV). Sobre una base temporal armada migración por migración, con un producto, una cuenta y una línea CARGADOS ANTES de la migración.
 *
 * Qué fija: (a) lo que ya existía queda con NULL y todo lo demás intacto; (b) los CHECK aceptan NULL y un nombre válido y rechazan vacío, bordes con espacios, saltos de línea, más de 80 y (producto) un tipo que no es PV;
 * (c) sin políticas, índices ni privilegios nuevos; (d) renombrar el producto o cambiarle/borrarle el nombre de cocina NO cambia lo congelado en una línea vieja; (e) el down.sql ABORTA si hay un nombre cargado en el
 * producto o congelado en una línea, sin tocar nada; (f) subir, bajar con datos limpios y volver a subir deja las tablas idénticas, y bajar dos veces no falla.
 *
 * Mutaciones: borrar el `RAISE` del down.sql rompe (e); quitar `char_length` de un CHECK rompe (b); quitar `"tipo" = 'PV'` del CHECK del producto rompe (b).
 */
const NOMBRE = "20261115170000_nombre_de_cocina";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const E = "emp-nombre-de-cocina";
const TABLAS = ["Producto", "CuentaItem"] as const;

let base: BaseTemporalMigrada;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  const porTabla = async (tabla: string) => ({
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [tabla]),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = ('"' || $1 || '"')::regclass ORDER BY 1`, [tabla]),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1 ORDER BY 1`, [tabla]),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY 1`, [tabla]),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = $1 AND grantee IN ('motor2_app', 'motor2_app_pruebas') ORDER BY 1, 2`, [tabla]),
  });
  return Object.fromEntries(await Promise.all(TABLAS.map(async (t) => [t, await porTabla(t)] as const)));
}

const ponerEnLinea = (valor: string | null) => base.cliente.query(`UPDATE "CuentaItem" SET "nombreDeCocina" = $1 WHERE "id" = 'item-viejo'`, [valor]);
const ponerEnProducto = (id: string, valor: string | null) => base.cliente.query(`UPDATE "Producto" SET "nombreDeCocina" = $2 WHERE "id" = $1`, [id, valor]);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(NOMBRE);
  await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await base.cliente.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('central',$1,'central')`, [E]);
  await base.cliente.query(`INSERT INTO "User" ("id","email") VALUES ('u-cocina','cocina@ejemplo.test')`);
  await base.cliente.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud","decimales") VALUES ('u',$1,'u','CANTIDAD',0)`, [E]);
  await base.cliente.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('bife',$1,'BF','Bife de chorizo','PV','u',18000)`, [E]);
  await base.cliente.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId") VALUES ('carne',$1,'CA','Carne cruda','MP','u')`, [E]);
  await base.cliente.query(`INSERT INTO "Mesa" ("id","empresaId","sucursalId","numero") VALUES ('mesa',$1,'central',1)`, [E]);
  await base.cliente.query(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId") VALUES ('cuenta',$1,'mesa','u-cocina')`, [E]);
  await base.cliente.query(`INSERT INTO "CuentaItem" ("id","empresaId","cuentaId","productoId","cantidad","precioUnitario") VALUES ('item-viejo',$1,'cuenta','bife',2,18000)`, [E]);
  fotoAntes = await foto();
}, 120_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

describe("Nombre de cocina: en el producto y congelado en la línea (migración 20261115170000)", () => {
  it("(a) al aplicar, el producto y la línea que ya existían quedan con nombreDeCocina NULL y lo demás sin cambios", async () => {
    const productosAntes = await q(`SELECT * FROM "Producto" ORDER BY "id"`);
    const lineasAntes = await q(`SELECT * FROM "CuentaItem" ORDER BY "id"`);
    await base.cliente.query(leer("migration.sql"));
    const sin = (filas: Record<string, unknown>[]) => filas.map((f) => Object.fromEntries(Object.entries(f).filter(([c]) => c !== "nombreDeCocina")));
    const productos = (await q(`SELECT * FROM "Producto" ORDER BY "id"`)) as Record<string, unknown>[];
    const lineas = (await q(`SELECT * FROM "CuentaItem" ORDER BY "id"`)) as Record<string, unknown>[];
    expect(productos.map((f) => f.nombreDeCocina)).toEqual([null, null]);
    expect(lineas.map((f) => f.nombreDeCocina)).toEqual([null]);
    expect(sin(productos), "ninguna otra columna del producto cambió").toEqual(productosAntes);
    expect(sin(lineas), "ninguna otra columna de la línea cambió").toEqual(lineasAntes);
    const f = (await foto()) as unknown as Record<string, { columnas: { columna: string }[] }>;
    const esperada = { columna: "nombreDeCocina", data_type: "text", is_nullable: "YES", column_default: null };
    for (const t of TABLAS) expect(f[t]!.columnas.find((c) => c.columna === "nombreDeCocina"), t).toEqual(esperada);
  });

  it("(b) los CHECK aceptan NULL y un nombre válido, y rechazan vacío, espacios en los bordes, saltos de línea, más de 80 caracteres y (producto) un tipo que no es PV", async () => {
    await ponerEnProducto("bife", "Medallón de bife de chorizo");
    await ponerEnProducto("bife", null);
    await ponerEnProducto("bife", "x".repeat(80));
    await ponerEnLinea("Medallón de bife de chorizo");
    await ponerEnLinea("x".repeat(80));
    for (const malo of ["", " Bife", "Bife ", "Bi\nfe", "Bi\r\nfe", "x".repeat(81)]) {
      await expect(ponerEnProducto("bife", malo), `producto ${JSON.stringify(malo)}`).rejects.toMatchObject({ code: "23514" });
      await expect(ponerEnLinea(malo), `línea ${JSON.stringify(malo)}`).rejects.toMatchObject({ code: "23514" });
    }
    await expect(ponerEnProducto("carne", "Carne"), "una materia prima no lleva nombre de cocina").rejects.toMatchObject({ code: "23514" });
    await ponerEnProducto("carne", null);
    await ponerEnProducto("bife", null);
    await ponerEnLinea(null);
  });

  it("(c) sin políticas, índices ni privilegios nuevos; lo nuevo son los dos CHECK", async () => {
    const despues = (await foto()) as unknown as Record<string, Record<string, { nombre?: string }[]>>;
    const antes = fotoAntes as typeof despues;
    for (const t of TABLAS) {
      for (const k of ["politicas", "privilegios", "indices"]) expect(despues[t]![k], `${t}.${k}`).toEqual(antes[t]![k]);
      expect(despues[t]!.restricciones!.filter((r) => !antes[t]!.restricciones!.some((a) => a.nombre === r.nombre)).map((r) => r.nombre), t).toEqual([
        t === "Producto" ? "Producto_nombre_de_cocina_chk" : "CuentaItem_nombre_de_cocina_chk",
      ]);
    }
  });

  it("(d) renombrar el producto o cambiarle o borrarle el nombre de cocina NO cambia el nombre congelado en una línea", async () => {
    await ponerEnProducto("bife", "Medallón de bife");
    await ponerEnLinea("Medallón de bife");
    await base.cliente.query(`UPDATE "Producto" SET "nombre" = 'Bife angosto' WHERE "id" = 'bife'`);
    await ponerEnProducto("bife", "Otro nombre de cocina");
    expect((await q(`SELECT "nombreDeCocina" FROM "CuentaItem" WHERE "id" = 'item-viejo'`))[0]).toEqual({ nombreDeCocina: "Medallón de bife" });
    await ponerEnProducto("bife", null);
    expect((await q(`SELECT "nombreDeCocina" FROM "CuentaItem" WHERE "id" = 'item-viejo'`))[0]).toEqual({ nombreDeCocina: "Medallón de bife" });
    await base.cliente.query(`UPDATE "Producto" SET "nombre" = 'Bife de chorizo' WHERE "id" = 'bife'`);
    await ponerEnLinea(null);
  });

  it("(e) el down.sql ABORTA si hay un nombre cargado en un producto o congelado en una línea, sin tocar nada", async () => {
    const arriba = await foto();
    for (const [poner, patron] of [
      [() => ponerEnProducto("bife", "Medallón"), /hay 1 producto\(s\) con nombre de cocina y 0 línea\(s\)/],
      [() => ponerEnLinea("Medallón"), /hay 0 producto\(s\) con nombre de cocina y 1 línea\(s\)/],
    ] as const) {
      await poner();
      await base.cliente.query("BEGIN");
      await expect(base.cliente.query(leer("down.sql"))).rejects.toThrow(patron);
      await base.cliente.query("ROLLBACK");
      expect(await foto(), "no tocó nada").toEqual(arriba);
      await ponerEnProducto("bife", null);
      await ponerEnLinea(null);
    }
  });

  it("(f) SUBIR, BAJAR, SUBIR: el down.sql deja las tablas como antes (sin perder filas), es idempotente, y volver a subir las deja como la primera vez", async () => {
    const arriba = await foto();
    await base.cliente.query(leer("down.sql"));
    expect(await foto(), "bajado = antes de la migración").toEqual(fotoAntes);
    expect(await q(`SELECT "id", "cantidad"::int AS cantidad FROM "CuentaItem"`)).toEqual([{ id: "item-viejo", cantidad: 2 }]);
    expect((await q(`SELECT count(*)::int AS n FROM "Producto"`))[0]).toEqual({ n: 2 });
    await base.cliente.query(leer("down.sql"));
    await base.cliente.query(leer("migration.sql"));
    expect(await foto(), "subido otra vez = la primera subida").toEqual(arriba);
  });
});
