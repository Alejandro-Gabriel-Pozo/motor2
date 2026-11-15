import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Presentación de compra por producto (etapa C1 / P3 etapa 1, `docs/diseno-productos-igual-a-pedernal-2026-11-13.md` §9): SUBIR, BAJAR y SUBIR de la migración real `20261115120000_presentacion_de_compra_por_producto`
 * sobre una base TEMPORAL descartable (`crearBaseTemporalMigrada`: solo Postgres local, jamás una base real), con su `down.sql` tal cual está en el repo.
 *
 * Qué comprueba:
 *  0. La migración existe, avisa que requiere autorización, tiene down.sql y verificacion-previa.sql.
 *  1. SUBIR: tres columnas nuevas (nombre, pesoVariable, version); las filas de antes se conservan TODAS, con el nombre de su unidad, sin peso variable, versión 1, misma cantidad y misma unidad; los CHECK y el índice único válidos;
 *     lo ÚNICO que cambia del catálogo son esas columnas, esos CHECK y ese índice (RLS, políticas y privilegios idénticos).
 *  2. Reglas de la base: mismo nombre sin distinguir mayúsculas en el mismo producto se rechaza (23505) y en OTRO producto u OTRA empresa pasa; nombre vacío, con espacios en los bordes o de más de 80 se rechaza; cantidad <= 0 se rechaza;
 *     versión < 1 se rechaza; el alta sin nombre (código anterior) sigue entrando; RLS: con el rol de la app una empresa no ve ni escribe las presentaciones de otra.
 *  3. CONCURRENCIA: dos altas simultáneas del mismo nombre (otra capitalización) desde dos conexiones: una gana y la otra recibe el rechazo, queda UNA fila.
 *  4. IDEMPOTENCIA: repetir el alta con el MISMO id (`ON CONFLICT (id) DO NOTHING`) deja la misma fila, sin duplicar.
 *  5. BAJAR: columnas, CHECK e índice desaparecen, el catálogo queda IDÉNTICO al de antes, los datos de antes (id, producto, unidad, cantidad, activa) intactos; bajar dos veces no falla. SUBIR otra vez deja el catálogo igual al de la primera subida.
 *  6. ATOMICIDAD: con una cantidad <= 0 ya guardada, subir ABORTA y no deja nada a medias; al limpiar, sube bien.
 *
 * Mutación (anotada en el commit): sacar un DROP del down.sql → rojo el caso 5; cambiar `lower("nombre")` por `"nombre"` en el índice → rojo los casos 2 y 3.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261115120000_presentacion_de_compra_por_producto";
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, MIGRACION, archivo), "utf8");
const INDICE = "Presentacion_empresaId_productoId_nombre_lower_key";
const CHEQUEOS = ["Presentacion_factorConversion_chk", "Presentacion_nombre_chk", "Presentacion_version_chk"];
const COLUMNAS = ["nombre", "pesoVariable", "version"];

const E1 = "empresa_c1a";
const E2 = "empresa_c1b";
let base: BaseTemporalMigrada;
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);

async function foto() {
  return {
    tablas: await q(`SELECT relname::text AS tabla, relrowsecurity AS rls FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY 1`),
    columnas: await q(`SELECT table_name::text AS tabla, column_name::text AS columna, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, ordinal_position`),
    indices: await q(`SELECT tablename::text AS tabla, indexname::text AS nombre, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1, 2`),
    restricciones: await q(`SELECT conrelid::regclass::text AS tabla, conname::text AS nombre, contype, convalidated, pg_get_constraintdef(oid) AS definicion FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
    politicas: await q(`SELECT tablename::text AS tabla, policyname::text AS nombre, permissive, roles::text AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    privilegios: await q(`SELECT table_name::text AS tabla, grantee::text AS rol, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee IN ('motor2_app', 'motor2_plataforma') ORDER BY 1, 2, 3`),
  };
}
type Foto = Awaited<ReturnType<typeof foto>>;
/** La foto sin lo que la migración agrega a "Presentacion": sus 3 columnas, sus 3 CHECK y su índice. */
const sinLoNuevo = (f: Foto): Foto => ({
  ...f,
  columnas: f.columnas.filter((c) => !(c.tabla === "Presentacion" && COLUMNAS.includes(c.columna as string))),
  indices: f.indices.filter((i) => i.nombre !== INDICE),
  restricciones: f.restricciones.filter((r) => !CHEQUEOS.includes(r.nombre as string)),
});
/** Lo de antes de cada presentación: lo que NINGUNA etapa de la migración puede cambiar. */
const deAntes = () => q(`SELECT "id", "empresaId", "productoId", "unidadCompraId", "factorConversion"::text AS "factorConversion", "activa" FROM "Presentacion" ORDER BY "id"`);

/** Devuelve el motivo del rechazo (índice o CHECK violado), `null` si la sentencia entró. */
async function resultado(texto: string, params: unknown[] = [], cliente: Client = base.cliente): Promise<string | null> {
  try {
    await cliente.query(texto, params);
    return null;
  } catch (e) {
    const m = /(?:unique constraint|check constraint) "([^"]+)"/.exec((e as Error).message);
    return m ? m[1]! : `otro error: ${(e as Error).message}`;
  }
}
const altaCon = (cliente: Client, id: string, empresa: string, producto: string, unidad: string, nombre: string | null, cantidad = 12) =>
  resultado(`INSERT INTO "Presentacion" ("id","empresaId","productoId","unidadCompraId","factorConversion","nombre") VALUES ($1,$2,$3,$4,$5,$6)`, [id, empresa, producto, unidad, cantidad, nombre], cliente);
const alta = (id: string, empresa: string, producto: string, unidad: string, nombre: string | null, cantidad = 12) => altaCon(base.cliente, id, empresa, producto, unidad, nombre, cantidad);
const borrarPruebas = () => q(`DELETE FROM "Presentacion" WHERE id LIKE 'x_%'`);

let antes: Foto;
let arriba: Foto;
let sembradas: Awaited<ReturnType<typeof deAntes>>;

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(MIGRACION);
  for (const e of [E1, E2]) await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,$1,$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [e]);
  for (const e of [E1, E2]) {
    await q(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ($1,$2,'kg','PESO'), ($3,$2,'caja','CANTIDAD'), ($4,$2,'bolsa','CANTIDAD'), ($5,$2,'unidad','CANTIDAD')`, [`u_kg_${e}`, e, `u_caja_${e}`, `u_bolsa_${e}`, `u_un_${e}`]);
    await q(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId") VALUES ($1,$2,$3,'Harina','MP',$4), ($5,$2,$6,'Gaseosa','MP',$7)`, [`p_harina_${e}`, e, `MP_h_${e}`, `u_kg_${e}`, `p_gaseosa_${e}`, `MP_g_${e}`, `u_un_${e}`]);
  }
  // Unidades sueltas: el único de siempre (producto, unidad) sigue vigente, así que cada alta de prueba usa una unidad propia.
  for (let i = 0; i < 40; i++) await q(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ($1,$2,$3,'CANTIDAD')`, [`u_n${i}`, E1, `unidad n${i}`]);
  // Lo que ya había cargado antes de la migración (el código anterior no escribe nombre).
  await q(`INSERT INTO "Presentacion" ("id","empresaId","productoId","unidadCompraId","factorConversion","activa") VALUES ('pr_bolsa',$1,'p_harina_${E1}','u_bolsa_${E1}',25,true), ('pr_caja',$1,'p_gaseosa_${E1}','u_caja_${E1}',12,false)`, [E1]);
  antes = await foto();
  sembradas = await deAntes();
}, 180_000);

afterAll(async () => {
  await base?.eliminar();
}, 60_000);

const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(archivo));
const P1 = `p_harina_${E1}`;
const P2 = `p_gaseosa_${E1}`;

describe("Presentación de compra por producto: subir, bajar y subir sobre una base temporal con todo lo anterior aplicado", () => {
  it("0. la migración existe, avisa la autorización y tiene down.sql y verificacion-previa.sql", () => {
    expect(readdirSync(RAIZ)).toContain(MIGRACION);
    expect(readdirSync(join(RAIZ, MIGRACION)).sort()).toEqual(["down.sql", "migration.sql", "verificacion-previa.sql"]);
    expect(sql("migration.sql").split("\n").slice(0, 4).join("\n")).toContain("REQUIERE AUTORIZACIÓN EXPRESA");
    expect(sql("down.sql").length).toBeGreaterThan(0);
  });

  it("1. SUBIR: tres columnas nuevas, las presentaciones de antes se conservan con el nombre de su unidad, y lo único que cambia son columnas, CHECK e índice", async () => {
    await correr("migration.sql");
    const f = await foto();
    expect(sinLoNuevo(f), "RLS, políticas, privilegios y el resto del catálogo, idénticos").toEqual(sinLoNuevo(antes));
    const columnas = await q<{ columna: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name::text AS columna, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'Presentacion' AND column_name = ANY($1::text[]) ORDER BY 1`,
      [COLUMNAS],
    );
    expect(columnas).toEqual([
      { columna: "nombre", is_nullable: "YES", column_default: null },
      { columna: "pesoVariable", is_nullable: "NO", column_default: "false" },
      { columna: "version", is_nullable: "NO", column_default: "1" },
    ]);
    expect(await deAntes(), "ninguna presentación se borró ni cambió de cantidad, unidad o estado").toEqual(sembradas);
    expect(await q(`SELECT "id","nombre","pesoVariable","version" FROM "Presentacion" ORDER BY "id"`)).toEqual([
      { id: "pr_bolsa", nombre: "bolsa", pesoVariable: false, version: 1 },
      { id: "pr_caja", nombre: "caja", pesoVariable: false, version: 1 },
    ]);
    const indice = await q<{ indisunique: boolean; indisvalid: boolean; definicion: string }>(
      `SELECT i.indisunique, i.indisvalid, pg_get_indexdef(i.indexrelid) AS definicion FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1`,
      [INDICE],
    );
    expect(indice).toHaveLength(1);
    expect(indice[0]).toMatchObject({ indisunique: true, indisvalid: true });
    expect(indice[0]!.definicion).toMatch(/ON public\."Presentacion" USING btree \("empresaId", "productoId", lower\(nombre\)\)/);
    const chequeos = await q<{ nombre: string; convalidated: boolean }>(`SELECT conname::text AS nombre, convalidated FROM pg_constraint WHERE conrelid = 'public."Presentacion"'::regclass AND conname = ANY($1::text[]) ORDER BY 1`, [CHEQUEOS]);
    expect(chequeos).toEqual(CHEQUEOS.map((nombre) => ({ nombre, convalidated: true })));
    // El único de siempre (producto, unidad) se quedó.
    expect(f.indices.map((i) => i.nombre)).toContain("Presentacion_productoId_unidadCompraId_key");
    arriba = f;
  });

  it("2. las reglas de la base: nombre único por producto sin mayúsculas, largo, cantidad, versión; el alta sin nombre del código anterior entra", async () => {
    // Mismo nombre (otra capitalización) en el MISMO producto, con otra unidad para no chocar con el único viejo.
    expect(await alta("x_a", E1, P1, "u_n0", "Caja x12")).toBeNull();
    expect(await alta("x_b", E1, P1, "u_n1", "CAJA X12")).toBe(INDICE);
    expect(await resultado(`UPDATE "Presentacion" SET "nombre" = 'bolsa' WHERE id = 'x_a'`)).toBe(INDICE);
    // Mismo nombre en OTRO producto o en OTRA empresa: pasa.
    expect(await alta("x_c", E1, P2, "u_n2", "Caja x12")).toBeNull();
    expect(await alta("x_d", E2, `p_harina_${E2}`, `u_caja_${E2}`, "Caja x12")).toBeNull();
    // El alta SIN nombre (código anterior): entra, y varias sin nombre no chocan entre sí.
    expect(await alta("x_e", E1, P1, "u_n3", null)).toBeNull();
    expect(await alta("x_f", E1, P2, "u_n4", null)).toBeNull();
    // Largo y bordes del nombre.
    expect(await alta("x_g", E1, P1, "u_n5", "")).toBe("Presentacion_nombre_chk");
    expect(await alta("x_h", E1, P2, "u_n6", " Caja")).toBe("Presentacion_nombre_chk");
    expect(await alta("x_i", E1, P2, "u_n7", "Caja ")).toBe("Presentacion_nombre_chk");
    expect(await alta("x_j", E1, P2, "u_n8", "x".repeat(81))).toBe("Presentacion_nombre_chk");
    expect(await alta("x_k", E1, P2, "u_n9", "x".repeat(80))).toBeNull();
    // Cantidad > 0 y versión >= 1.
    expect(await alta("x_l", E1, P1, "u_n10", "Otra", 0)).toBe("Presentacion_factorConversion_chk");
    expect(await alta("x_l", E1, P1, "u_n10", "Otra", -1)).toBe("Presentacion_factorConversion_chk");
    expect(await resultado(`UPDATE "Presentacion" SET "version" = 0 WHERE id = 'x_a'`)).toBe("Presentacion_version_chk");
    // Peso variable y versión: se guardan.
    expect(await resultado(`UPDATE "Presentacion" SET "pesoVariable" = true, "version" = "version" + 1 WHERE id = 'x_a'`)).toBeNull();
    expect(await q(`SELECT "pesoVariable","version" FROM "Presentacion" WHERE id = 'x_a'`)).toEqual([{ pesoVariable: true, version: 2 }]);
    await borrarPruebas();
    expect(await deAntes()).toEqual(sembradas);
  });

  // La base temporal no pasó por los privilegios por defecto del rol de la app (los pone `crear-rol-motor2-app.sql` en las bases del runner): se los damos DENTRO de cada transacción de prueba, que se deshace.
  const darPrivilegiosDeLaApp = () => base.cliente.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO motor2_app`);

  it("2b. AISLAMIENTO: con el rol de la app, una empresa no ve ni escribe las presentaciones de otra", async () => {
    await q(`INSERT INTO "Presentacion" ("id","empresaId","productoId","unidadCompraId","factorConversion","nombre") VALUES ('x_e2', $1, $2, $3, 6, 'Caja x6')`, [E2, `p_harina_${E2}`, `u_caja_${E2}`]);
    const tx = async (empresa: string, sentencia: string) => {
      await base.cliente.query("BEGIN");
      try {
        await darPrivilegiosDeLaApp();
        await base.cliente.query("SET LOCAL ROLE motor2_app");
        await base.cliente.query(`SELECT set_config('app.empresa_id', $1, true)`, [empresa]);
        return await resultadoDeTx(sentencia);
      } finally {
        await base.cliente.query("ROLLBACK");
      }
    };
    const resultadoDeTx = async (sentencia: string) => (await base.cliente.query(sentencia)).rows;
    expect(await tx(E1, `SELECT "id" FROM "Presentacion" ORDER BY 1`)).toEqual([{ id: "pr_bolsa" }, { id: "pr_caja" }]);
    expect(await tx(E2, `SELECT "id" FROM "Presentacion" ORDER BY 1`)).toEqual([{ id: "x_e2" }]);
    // Escribir una fila de la otra empresa: la política lo rechaza.
    await base.cliente.query("BEGIN");
    try {
      await darPrivilegiosDeLaApp();
      await base.cliente.query("SET LOCAL ROLE motor2_app");
      await base.cliente.query(`SELECT set_config('app.empresa_id', $1, true)`, [E1]);
      await expect(base.cliente.query(`INSERT INTO "Presentacion" ("id","empresaId","productoId","unidadCompraId","factorConversion","nombre") VALUES ('x_cruz', $1, $2, $3, 6, 'Cruzada')`, [E2, `p_harina_${E2}`, `u_bolsa_${E2}`])).rejects.toThrow(/row-level security/);
    } finally {
      await base.cliente.query("ROLLBACK");
    }
    await borrarPruebas();
  });

  it("3. CONCURRENCIA: dos altas simultáneas del mismo nombre desde dos conexiones: una gana, la otra recibe el rechazo, queda UNA fila", async () => {
    const otra = new Client({ connectionString: base.url });
    await otra.connect();
    try {
      for (let ronda = 0; ronda < 10; ronda++) {
        const nombre = `Pack x${ronda}`;
        const [r1, r2] = await Promise.all([altaCon(base.cliente, `x_c1_${ronda}`, E1, P1, `u_n${11 + ronda}`, nombre), altaCon(otra, `x_c2_${ronda}`, E1, P1, `u_n${21 + ronda}`, nombre.toUpperCase())]);
        expect([r1, r2].filter((r) => r === null), `ronda ${ronda}: una sola entra`).toHaveLength(1);
        expect([r1, r2].filter((r) => r === INDICE), `ronda ${ronda}: la otra recibe el rechazo del índice`).toHaveLength(1);
        expect(await q(`SELECT 1 FROM "Presentacion" WHERE lower("nombre") = lower($1) AND "productoId" = $2`, [nombre, P1])).toHaveLength(1);
        await borrarPruebas();
      }
    } finally {
      await otra.end();
    }
    await borrarPruebas();
  });

  it("4. IDEMPOTENCIA: repetir el alta con el mismo id deja la misma fila, sin duplicar", async () => {
    const insertar = () =>
      base.cliente.query(`INSERT INTO "Presentacion" ("id","empresaId","productoId","unidadCompraId","factorConversion","nombre") VALUES ('x_idem',$1,$2,$3,12,'Caja x12') ON CONFLICT ("id") DO NOTHING`, [E1, P1, "u_n32"]);
    expect((await insertar()).rowCount).toBe(1);
    expect((await insertar()).rowCount, "el reintento no inserta nada").toBe(0);
    expect((await insertar()).rowCount).toBe(0);
    expect(await q(`SELECT "id","nombre","factorConversion"::text AS f FROM "Presentacion" WHERE "nombre" = 'Caja x12'`)).toEqual([{ id: "x_idem", nombre: "Caja x12", f: "12.0000" }]);
    await borrarPruebas();
  });

  it("5. BAJAR: columnas, CHECK e índice desaparecen y el catálogo queda idéntico al de antes; los datos de antes intactos; bajar dos veces no falla; SUBIR otra vez da lo mismo que la primera", async () => {
    await correr("down.sql");
    expect(await foto(), "tras bajar, el catálogo es idéntico al de antes de la migración").toEqual(antes);
    expect(await deAntes(), "bajar no toca ninguna presentación de antes").toEqual(sembradas);
    await correr("down.sql");
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
    await correr("migration.sql");
    expect(await foto()).toEqual(arriba);
    expect(await deAntes()).toEqual(sembradas);
    await correr("down.sql");
    expect(await foto()).toEqual(antes);
  });

  it("6. ATOMICIDAD: con una cantidad <= 0 ya guardada, subir ABORTA y no deja nada a medias; al limpiar, sube bien", async () => {
    await q(`INSERT INTO "Presentacion" ("id","empresaId","productoId","unidadCompraId","factorConversion") VALUES ('x_dup1', $1, $2, $3, 6)`, [E1, P1, "u_n33"]);
    // Una cantidad <= 0 ya guardada (el CHECK no se puede validar).
    await q(`UPDATE "Presentacion" SET "factorConversion" = 0 WHERE id = 'x_dup1'`);
    await expect(correr("migration.sql")).rejects.toThrow(/Presentacion_factorConversion_chk|check constraint/);
    expect(await foto(), "la subida abortada no dejó nada a medias").toEqual(antes);
    await q(`DELETE FROM "Presentacion" WHERE id LIKE 'x_dup%'`);
    await correr("migration.sql");
    expect(await foto()).toEqual(arriba);
  });
});
