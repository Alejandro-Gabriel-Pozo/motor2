import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Ticket del cliente con el nombre de la carta y sin lo oculto (2026-11-05) — migración 20261105100000_ticket_nombre_y_oculto_en_carta: `CuentaItem.nombreEnTicket` (TEXT NULL con un CHECK: NULL o de 1 a 80
 * caracteres, sin espacios en los bordes ni saltos de línea) y `OpcionElegidaEnLinea.ocultaEnCarta` (BOOLEAN NOT NULL DEFAULT false). Sobre una base temporal armada migración por migración, con una línea de cuenta
 * CARGADA ANTES de la migración.
 *
 * Qué fija: (a) la línea vieja queda con `nombreEnTicket` NULL (se imprime como siempre) y todo lo demás intacto, y la foto nueva nace con `ocultaEnCarta` en false (NOT NULL, default false); (b) el CHECK acepta NULL
 * y un nombre válido y rechaza vacío, bordes con espacios, saltos de línea y más de 80; (c) sin políticas, índices ni privilegios nuevos; (d) el down.sql ABORTA si hay algún nombre congelado, sin tocar nada;
 * (e) subir, bajar y subir deja las tablas idénticas, y bajar dos veces no falla.
 *
 * Mutaciones: borrar el `RAISE` del down.sql rompe (d); quitar `char_length` del CHECK rompe (b); sacar el `DEFAULT false` rompe (a).
 */
const NOMBRE = "20261105100000_ticket_nombre_y_oculto_en_carta";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const E = "emp-ticket-oculto";
const TABLAS = ["CuentaItem", "OpcionElegidaEnLinea"] as const;

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

const poner = (valor: string | null) => base.cliente.query(`UPDATE "CuentaItem" SET "nombreEnTicket" = $1 WHERE "id" = 'item-viejo'`, [valor]);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(NOMBRE);
  await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await base.cliente.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('central',$1,'central')`, [E]);
  await base.cliente.query(`INSERT INTO "User" ("id","email") VALUES ('u-ticket','ticket@ejemplo.test')`);
  await base.cliente.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud","decimales") VALUES ('u',$1,'u','CANTIDAD',0)`, [E]);
  await base.cliente.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('bife',$1,'BF','Bife de chorizo','PV','u',18000)`, [E]);
  await base.cliente.query(`INSERT INTO "Mesa" ("id","empresaId","sucursalId","numero") VALUES ('mesa',$1,'central',1)`, [E]);
  await base.cliente.query(`INSERT INTO "Cuenta" ("id","empresaId","mesaId","abiertaPorId") VALUES ('cuenta',$1,'mesa','u-ticket')`, [E]);
  await base.cliente.query(`INSERT INTO "CuentaItem" ("id","empresaId","cuentaId","productoId","cantidad","precioUnitario") VALUES ('item-viejo',$1,'cuenta','bife',2,18000)`, [E]);
  fotoAntes = await foto();
}, 120_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

describe("Ticket: nombre de la carta y lo oculto congelados al vender (migración 20261105100000)", () => {
  it("(a) al aplicar, la línea vieja queda con nombreEnTicket NULL y lo demás sin cambios; la foto nueva es BOOLEAN NOT NULL DEFAULT false", async () => {
    const antes = await q(`SELECT * FROM "CuentaItem" ORDER BY "id"`);
    await base.cliente.query(leer("migration.sql"));
    const despues = (await q(`SELECT * FROM "CuentaItem" ORDER BY "id"`)) as Record<string, unknown>[];
    expect(despues.map((f) => f.nombreEnTicket)).toEqual([null]);
    expect(despues.map((f) => Object.fromEntries(Object.entries(f).filter(([c]) => c !== "nombreEnTicket"))), "ninguna otra columna cambió").toEqual(antes);
    const f = (await foto()) as unknown as Record<string, { columnas: { columna: string }[] }>;
    expect(f.CuentaItem!.columnas.at(-1)).toEqual({ columna: "nombreEnTicket", data_type: "text", is_nullable: "YES", column_default: null });
    expect(f.OpcionElegidaEnLinea!.columnas.at(-1)).toEqual({ columna: "ocultaEnCarta", data_type: "boolean", is_nullable: "NO", column_default: "false" });
  });

  it("(b) el CHECK acepta NULL y un nombre válido, y rechaza vacío, espacios en los bordes, saltos de línea y más de 80 caracteres", async () => {
    await poner("Bife con papas");
    await poner(null);
    await poner("x".repeat(80));
    for (const malo of ["", " Bife", "Bife ", "Bi\nfe", "Bi\r\nfe", "x".repeat(81)]) {
      await expect(poner(malo), JSON.stringify(malo)).rejects.toMatchObject({ code: "23514" });
    }
    await poner(null);
  });

  it("(c) sin políticas, índices ni privilegios nuevos; lo nuevo es el CHECK de CuentaItem", async () => {
    const despues = (await foto()) as unknown as Record<string, Record<string, { nombre?: string }[]>>;
    const antes = fotoAntes as typeof despues;
    for (const t of TABLAS) for (const k of ["politicas", "privilegios", "indices"]) expect(despues[t]![k], `${t}.${k}`).toEqual(antes[t]![k]);
    expect(despues.CuentaItem!.restricciones!.filter((r) => !antes.CuentaItem!.restricciones!.some((a) => a.nombre === r.nombre)).map((r) => r.nombre)).toEqual(["CuentaItem_nombre_en_ticket_chk"]);
    expect(despues.OpcionElegidaEnLinea!.restricciones).toEqual(antes.OpcionElegidaEnLinea!.restricciones);
  });

  it("(d) el down.sql ABORTA si hay algún nombre congelado, sin tocar nada", async () => {
    await poner("Bife con papas");
    const arriba = await foto();
    await base.cliente.query("BEGIN");
    await expect(base.cliente.query(leer("down.sql"))).rejects.toThrow(/hay 1 línea\(s\) con nombre congelado para el ticket/);
    await base.cliente.query("ROLLBACK");
    expect(await foto()).toEqual(arriba);
    expect((await q(`SELECT "nombreEnTicket" FROM "CuentaItem"`))[0]).toEqual({ nombreEnTicket: "Bife con papas" });
    await poner(null);
  });

  it("(e) SUBIR, BAJAR, SUBIR: el down.sql deja las tablas como antes (sin perder filas), es idempotente, y volver a subir las deja como la primera vez", async () => {
    const arriba = await foto();
    await base.cliente.query(leer("down.sql"));
    expect(await foto(), "bajado = antes de la migración").toEqual(fotoAntes);
    expect(await q(`SELECT "id", "cantidad"::int AS cantidad FROM "CuentaItem"`)).toEqual([{ id: "item-viejo", cantidad: 2 }]);
    await base.cliente.query(leer("down.sql"));
    await base.cliente.query(leer("migration.sql"));
    expect(await foto(), "subido otra vez = la primera subida").toEqual(arriba);
  });
});
