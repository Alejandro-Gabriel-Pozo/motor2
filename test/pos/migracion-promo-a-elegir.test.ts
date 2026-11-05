import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Promo «a elegir» (2026-11-05, etapa N1 PR A) — migración 20261105120000_promo_entrada_a_elegir: `EntradaDeCupo.modoDeOpciones` (TEXT NOT NULL DEFAULT 'FIJAS', CHECK IN ('FIJAS','A_ELEGIR')). Sobre una base temporal
 * armada migración por migración, con una entrada de promo CARGADA ANTES de la migración.
 *
 * Qué fija: (a) la entrada vieja queda `FIJAS` y todo lo demás intacto; (b) el CHECK acepta los dos modos y rechaza cualquier otro valor y NULL; (c) sin políticas, índices ni privilegios nuevos (lo nuevo es el
 * CHECK); (d) el down.sql ABORTA si hay alguna entrada `A_ELEGIR`, sin tocar nada; (e) subir, bajar y subir deja la tabla idéntica, y bajar dos veces no falla.
 *
 * Mutaciones: borrar el `RAISE` del down.sql rompe (d); sacar el `DEFAULT 'FIJAS'` rompe (a); sacar el CHECK rompe (b).
 */
const NOMBRE = "20261105120000_promo_entrada_a_elegir";
const RAIZ = join(__dirname, "../../prisma/migrations", NOMBRE);
const leer = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, archivo), "utf8");
const E = "emp-promo-a-elegir";

let base: BaseTemporalMigrada;
let fotoAntes: unknown;

const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  return {
    columnas: await q(`SELECT column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'EntradaDeCupo' ORDER BY ordinal_position`),
    restricciones: await q(`SELECT conname::text AS nombre, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE conrelid = '"EntradaDeCupo"'::regclass ORDER BY 1`),
    indices: await q(`SELECT indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'EntradaDeCupo' ORDER BY 1`),
    politicas: await q(`SELECT policyname::text AS nombre, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'EntradaDeCupo' ORDER BY 1`),
    privilegios: await q(`SELECT grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'EntradaDeCupo' AND grantee IN ('motor2_app', 'motor2_app_pruebas') ORDER BY 1, 2`),
  };
}

const ponerModo = (valor: string | null) => base.cliente.query(`UPDATE "EntradaDeCupo" SET "modoDeOpciones" = $1 WHERE "id" = 'entrada-vieja'`, [valor]);

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(NOMBRE);
  await base.cliente.query(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await base.cliente.query(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud","decimales") VALUES ('u',$1,'u','CANTIDAD',0)`, [E]);
  await base.cliente.query(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('bife',$1,'BF','Bife de chorizo','PV','u',18000)`, [E]);
  await base.cliente.query(`INSERT INTO "SeccionCarta" ("id","empresaId","nombre") VALUES ('sec',$1,'Menús')`, [E]);
  await base.cliente.query(`INSERT INTO "PromoCarta" ("id","empresaId","seccionCartaId","titulo","precio") VALUES ('promo',$1,'sec','Menú Empresa 1',55000)`, [E]);
  await base.cliente.query(`INSERT INTO "PromoCartaCupo" ("id","empresaId","promoCartaId","tipo","nombre","cantidadMinima","cantidadMaxima") VALUES ('cupo',$1,'promo','LISTA','Platos principales',1,1)`, [E]);
  await base.cliente.query(`INSERT INTO "EntradaDeCupo" ("id","empresaId","cupoId","productoId") VALUES ('entrada-vieja',$1,'cupo','bife')`, [E]);
  fotoAntes = await foto();
}, 120_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

describe("Promo «a elegir»: EntradaDeCupo.modoDeOpciones (migración 20261105120000)", () => {
  it("(a) al aplicar, la entrada vieja queda FIJAS y lo demás sin cambios; la columna es TEXT NOT NULL DEFAULT 'FIJAS'", async () => {
    const antes = await q(`SELECT * FROM "EntradaDeCupo" ORDER BY "id"`);
    await base.cliente.query(leer("migration.sql"));
    const despues = (await q(`SELECT * FROM "EntradaDeCupo" ORDER BY "id"`)) as Record<string, unknown>[];
    expect(despues.map((f) => f.modoDeOpciones)).toEqual(["FIJAS"]);
    expect(despues.map((f) => Object.fromEntries(Object.entries(f).filter(([c]) => c !== "modoDeOpciones"))), "ninguna otra columna cambió").toEqual(antes);
    const f = (await foto()) as unknown as { columnas: { columna: string }[] };
    expect(f.columnas.at(-1)).toEqual({ columna: "modoDeOpciones", data_type: "text", is_nullable: "NO", column_default: "'FIJAS'::text" });
  });

  it("(b) el CHECK acepta FIJAS y A_ELEGIR y rechaza cualquier otro valor y NULL", async () => {
    await ponerModo("A_ELEGIR");
    await ponerModo("FIJAS");
    for (const malo of ["", "fijas", "A_ELEGIR ", "OTRO"]) await expect(ponerModo(malo), JSON.stringify(malo)).rejects.toMatchObject({ code: "23514" });
    await expect(ponerModo(null)).rejects.toMatchObject({ code: "23502" });
  });

  it("(c) sin políticas, índices ni privilegios nuevos; lo nuevo es el CHECK", async () => {
    const despues = (await foto()) as Record<string, { nombre?: string }[]>;
    const antes = fotoAntes as typeof despues;
    for (const k of ["politicas", "privilegios", "indices"]) expect(despues[k], k).toEqual(antes[k]);
    expect(despues.restricciones!.filter((r) => !antes.restricciones!.some((a) => a.nombre === r.nombre)).map((r) => r.nombre)).toEqual(["EntradaDeCupo_modo_de_opciones_chk"]);
  });

  it("(d) el down.sql ABORTA si hay alguna entrada A_ELEGIR, sin tocar nada", async () => {
    await ponerModo("A_ELEGIR");
    const arriba = await foto();
    await base.cliente.query("BEGIN");
    await expect(base.cliente.query(leer("down.sql"))).rejects.toThrow(/hay 1 entrada\(s\) de promo «a elegir»/);
    await base.cliente.query("ROLLBACK");
    expect(await foto()).toEqual(arriba);
    expect(await q(`SELECT "modoDeOpciones" FROM "EntradaDeCupo"`)).toEqual([{ modoDeOpciones: "A_ELEGIR" }]);
    await ponerModo("FIJAS");
  });

  it("(e) SUBIR, BAJAR, SUBIR: el down.sql deja la tabla como antes (sin perder filas), es idempotente, y volver a subir la deja como la primera vez", async () => {
    const arriba = await foto();
    await base.cliente.query(leer("down.sql"));
    expect(await foto(), "bajado = antes de la migración").toEqual(fotoAntes);
    expect(await q(`SELECT "id" FROM "EntradaDeCupo"`)).toEqual([{ id: "entrada-vieja" }]);
    await base.cliente.query(leer("down.sql"));
    await base.cliente.query(leer("migration.sql"));
    expect(await foto(), "subido otra vez = la primera subida").toEqual(arriba);
  });
});
