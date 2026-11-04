import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * «Nombre en la carta» (2026-11-04) — migración 20261104130000_contenido_carta_nombre_en_carta: `ContenidoCartaProducto.nombreEnCarta`, TEXT NULL con un CHECK (NULL o de 1 a 80 caracteres, sin
 * espacios en los bordes ni saltos de línea). Sobre una base temporal armada migración por migración, con contenido de carta CARGADO ANTES de la migración.
 *
 * Qué fija: (a) el contenido viejo queda en NULL (la carta usa el nombre del producto) y todo lo demás intacto; (b) el CHECK acepta NULL y un nombre válido y rechaza vacío, bordes con espacios, saltos
 * de línea y más de 80; (c) sin políticas, índices ni privilegios nuevos; (d) el down.sql ABORTA si hay algún nombre cargado, sin tocar nada; (e) subir, bajar y subir deja la tabla idéntica, y bajar
 * dos veces no falla.
 *
 * Mutaciones: borrar el `RAISE` del down.sql rompe (d); quitar `char_length` del CHECK rompe (b).
 */
const NOMBRE = "20261104130000_contenido_carta_nombre_en_carta";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const E = "emp-nombre-en-carta";

let base: BaseTemporalMigrada;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function fotoDelContenido() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ContenidoCartaProducto' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"ContenidoCartaProducto"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'ContenidoCartaProducto' ORDER BY 1`),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ContenidoCartaProducto' ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'ContenidoCartaProducto' AND grantee IN ('motor2_app', 'motor2_app_pruebas') ORDER BY 1, 2`),
  };
}

const poner = (valor: string | null) => base.cliente.query(`UPDATE "ContenidoCartaProducto" SET "nombreEnCarta" = $1 WHERE "id" = 'contenido-central'`, [valor]);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(NOMBRE);
  await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await base.cliente.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud","decimales") VALUES ('u',$1,'u','CANTIDAD',0)`, [E]);
  await base.cliente.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('central',$1,'central')`, [E]);
  await base.cliente.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('pizzas',$1,'PZ','Pizzas','PV','u',18000)`, [E]);
  await base.cliente.query(
    `INSERT INTO "ContenidoCartaProducto" ("id","empresaId","sucursalId","productoId","visibleEnCarta","descripcion","tags","especial","orden","actualizadoEn") VALUES ('contenido-central',$1,'central','pizzas',true,'A la piedra','{Regional}',true,3,now())`,
    [E]
  );
  fotoAntes = await fotoDelContenido();
}, 120_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

describe("«Nombre en la carta» del contenido de carta (migración 20261104130000)", () => {
  it("(a) al aplicar, el contenido viejo queda en NULL (usa el nombre del producto) y lo demás sin cambios; la columna es TEXT NULL sin default, al final de la tabla", async () => {
    const antes = await q(`SELECT * FROM "ContenidoCartaProducto" ORDER BY "id"`);
    await base.cliente.query(leer("migration.sql"));
    const despues = (await q(`SELECT * FROM "ContenidoCartaProducto" ORDER BY "id"`)) as Record<string, unknown>[];
    expect(despues.map((f) => f.nombreEnCarta)).toEqual([null]);
    expect(despues.map((f) => Object.fromEntries(Object.entries(f).filter(([c]) => c !== "nombreEnCarta"))), "ninguna otra columna cambió").toEqual(antes);
    const columnas = (await fotoDelContenido()).columnas as { columna: string }[];
    expect(columnas.at(-1)).toEqual({ columna: "nombreEnCarta", data_type: "text", is_nullable: "YES", column_default: null });
  });

  it("(b) el CHECK acepta NULL y un nombre válido, y rechaza vacío, espacios en los bordes, saltos de línea y más de 80 caracteres", async () => {
    await poner("Milanesa napolitana");
    await poner(null);
    await poner("x".repeat(80));
    for (const malo of ["", " Milanesa", "Milanesa ", "Mila\nnesa", "Mila\r\nnesa", "x".repeat(81)]) {
      await expect(poner(malo), JSON.stringify(malo)).rejects.toMatchObject({ code: "23514" });
    }
    await poner(null);
  });

  it("(b2) el único parcial: dos platos VISIBLES de la MISMA sucursal no pueden tener el mismo nombre en la carta (sin distinguir mayúsculas); en otra sucursal sí, y los NULL no chocan", async () => {
    await base.cliente.query("BEGIN");
    try {
      await base.cliente.query(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('norte',$1,'norte')`, [E]);
      await base.cliente.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('flan',$1,'FL','Flan','PV','u',5000)`, [E]);
      const alta = (id: string, sucursal: string, producto: string, nombre: string | null) =>
        base.cliente.query(
          `INSERT INTO "ContenidoCartaProducto" ("id","empresaId","sucursalId","productoId","visibleEnCarta","tags","especial","orden","actualizadoEn","nombreEnCarta") VALUES ($1,$2,$3,$4,true,'{}',false,0,now(),$5)`,
          [id, E, sucursal, producto, nombre]
        );
      await poner("La Napo");
      await alta("c-flan-nulo", "central", "flan", null);
      await base.cliente.query(`SAVEPOINT s1`);
      await expect(base.cliente.query(`UPDATE "ContenidoCartaProducto" SET "nombreEnCarta" = 'la napo' WHERE "id" = 'c-flan-nulo'`), "mismo nombre, otras mayúsculas").rejects.toMatchObject({ code: "23505" });
      await base.cliente.query(`ROLLBACK TO SAVEPOINT s1`);
      await alta("c-flan-norte", "norte", "flan", "La Napo");
      // Un plato OCULTO con el mismo nombre no molesta (se vuelve a chequear al mostrarlo): el único es parcial sobre los visibles.
      await base.cliente.query(`UPDATE "ContenidoCartaProducto" SET "visibleEnCarta" = false WHERE "id" = 'c-flan-nulo'`);
      await base.cliente.query(`UPDATE "ContenidoCartaProducto" SET "nombreEnCarta" = 'LA NAPO' WHERE "id" = 'c-flan-nulo'`);
      await expect(base.cliente.query(`UPDATE "ContenidoCartaProducto" SET "visibleEnCarta" = true WHERE "id" = 'c-flan-nulo'`), "mostrarlo choca").rejects.toMatchObject({ code: "23505" });
    } finally {
      await base.cliente.query("ROLLBACK");
    }
    await poner(null);
  });

  it("(c) sin políticas ni privilegios nuevos (la tabla tiene privilegios de TABLA); lo nuevo es el CHECK y el único parcial por sucursal", async () => {
    const despues = (await fotoDelContenido()) as Record<string, { nombre?: string }[]>;
    const antes = fotoAntes as Record<string, { nombre?: string }[]>;
    for (const k of ["politicas", "privilegios"]) expect(despues[k], k).toEqual(antes[k]);
    expect(despues.restricciones!.filter((r) => !antes.restricciones!.some((a) => a.nombre === r.nombre)).map((r) => r.nombre)).toEqual(["ContenidoCartaProducto_nombre_en_carta_chk"]);
    expect(despues.indices!.filter((r) => !antes.indices!.some((a) => a.nombre === r.nombre)).map((r) => r.nombre)).toEqual(["ContenidoCartaProducto_sucursal_nombre_en_carta_key"]);
  });

  it("(d) el down.sql ABORTA si hay algún nombre cargado, sin tocar nada", async () => {
    await poner("Milanesa napolitana");
    const arriba = await fotoDelContenido();
    await base.cliente.query("BEGIN");
    await expect(base.cliente.query(leer("down.sql"))).rejects.toThrow(/hay 1 contenido\(s\) de carta con «Nombre en la carta» cargado/);
    await base.cliente.query("ROLLBACK");
    expect(await fotoDelContenido()).toEqual(arriba);
    expect((await q(`SELECT "nombreEnCarta" FROM "ContenidoCartaProducto"`))[0]).toEqual({ nombreEnCarta: "Milanesa napolitana" });
    await poner(null);
  });

  it("(e) SUBIR, BAJAR, SUBIR: el down.sql deja la tabla como antes (sin perder filas), es idempotente, y volver a subir la deja como la primera vez", async () => {
    const arriba = await fotoDelContenido();
    await base.cliente.query(leer("down.sql"));
    expect(await fotoDelContenido(), "bajado = antes de la migración").toEqual(fotoAntes);
    expect(await q(`SELECT "id", "descripcion", "especial", "orden" FROM "ContenidoCartaProducto"`)).toEqual([{ id: "contenido-central", descripcion: "A la piedra", especial: true, orden: 3 }]);
    await base.cliente.query(leer("down.sql"));
    await base.cliente.query(leer("migration.sql"));
    expect(await fotoDelContenido(), "subido otra vez = la primera subida").toEqual(arriba);
  });
});
