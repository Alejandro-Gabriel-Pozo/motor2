import { readFileSync } from "node:fs";
import { join } from "node:path";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FICHAS_DE_TEXTO, textoDeFichaDesdeTexto, type FichaDeTexto } from "../../src/core/datos/fichas-de-texto";
import { crearBaseTemporalMigrada, type BaseTemporalMigrada } from "../setup/base-temporal-migrada";

/**
 * Nombres con la lista de permitidos también en la base (migración 20261117190000; frente 3, E-3 paso 2). Contra Postgres local, nunca una base real. Prueba:
 *  - GUARDA: con un nombre fuera de la lista guardado, la migración aborta nombrando columna y cantidad, y no deja nada;
 *  - SUBIR: cada CHECK rechaza un nombre fuera de la lista (23514) y acepta uno bueno; los datos buenos quedan intactos;
 *  - PARIDAD con el código (el oráculo es `textoDeFichaDesdeTexto`): para miles de textos con los caracteres de borde (espacios de todo tipo, tabulador, salto, `_`, `<`, emoji, NFC/NFD, `+`/`-` al inicio, `¿ ¡ ? ! % $`) la función
 *    de la base dice «sí» EXACTAMENTE cuando el código acepta el texto y no lo cambiaría al normalizarlo;
 *  - BAJAR no pierde nada y se puede dos veces; SUBIR OTRA VEZ deja el catálogo idéntico.
 */
const RAIZ = join(__dirname, "../../prisma/migrations");
const MIGRACION = "20261117190000_nombres_con_ficha_check";
const E = "empresa_fic";
const COLUMNAS = ["Producto", "Insumo", "CategoriaProducto", "Proveedor", "Cliente", "SeccionCarta", "GrupoDeOpciones", "OpcionDeGrupo", "Sucursal", "Rol"] as const;

let base: BaseTemporalMigrada;
const sql = (archivo: "migration.sql" | "down.sql") => readFileSync(join(RAIZ, MIGRACION, archivo), "utf8");
const correr = (archivo: "migration.sql" | "down.sql") => base.cliente.query(sql(archivo));
const q = <T extends object = Record<string, unknown>>(texto: string, params: unknown[] = []) => base.cliente.query<T>(texto, params).then((r) => r.rows);
const falla = async (texto: string, params: unknown[] = []): Promise<string> => {
  await base.cliente.query("BEGIN");
  try {
    await base.cliente.query(texto, params);
    return "sin error";
  } catch (e) {
    return (e as { code?: string }).code ?? "sin código";
  } finally {
    await base.cliente.query("ROLLBACK");
  }
};
const catalogo = async () => ({
  funcion: await q(`SELECT proname::text AS nombre FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'nombre_de_ficha_valido'`),
  checks: await q(`SELECT conrelid::regclass::text AS t, conname::text AS nombre, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname LIKE '%\\_ficha\\_chk' ORDER BY 1, 2`),
});

beforeAll(async () => {
  base = await crearBaseTemporalMigrada();
  await base.aplicarAntesDe(MIGRACION);
  await q(`INSERT INTO "Empresa" ("id","nombre","slug","zonaHoraria","moneda","estado") VALUES ($1,'Hotel Centro',$1,'America/Argentina/Buenos_Aires','ARS','ACTIVE')`, [E]);
  await q(`INSERT INTO "Unidad" ("id","empresaId","nombre","magnitud") VALUES ('uni_f',$1,'u','CANTIDAD')`, [E]);
  await q(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('prod_f1',$1,'PV_1','Milanesa napolitana','PV','uni_f',8000)`, [E]);
}, 300_000);

afterAll(async () => {
  await base?.eliminar();
});

describe("Nombres con ficha en la base (subir, bajar y subir; paridad con el código)", () => {
  let primera: Awaited<ReturnType<typeof catalogo>>;

  it("GUARDA: con un nombre fuera de la lista guardado la migración aborta, lo nombra y no deja nada", async () => {
    await q(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('prod_mal',$1,'PV_2','Mila<b>nesa','PV','uni_f',1)`, [E]);
    await expect(correr("migration.sql")).rejects.toThrow(/Producto\.nombre=1/);
    expect(await catalogo()).toEqual({ funcion: [], checks: [] });
    await q(`DELETE FROM "Producto" WHERE "id" = 'prod_mal'`);
  });

  it("SUBIR: diez CHECK; rechazan lo que no cumple y aceptan lo bueno; los datos existentes quedan intactos", async () => {
    await correr("migration.sql");
    primera = await catalogo();
    expect(primera.checks).toHaveLength(COLUMNAS.length);
    expect(await q(`SELECT "nombre" FROM "Producto"`)).toEqual([{ nombre: "Milanesa napolitana" }]);
    const alta = (nombre: string) => falla(`INSERT INTO "Producto" ("id","empresaId","codigo","nombre","tipo","unidadStockId","precioVenta") VALUES ('prod_x',$1,'PV_X',$2,'PV','uni_f',1)`, [E, nombre]);
    expect(await alta("Flan casero")).toBe("sin error");
    expect(await alta("¿Querés papas? 50% $500")).toBe("sin error");
    for (const malo of ["", " Flan", "Flan ", "Flan  casero", "Fl_an", "Flan\ttab", "Flan\n", "+Flan", "-Flan", "Flan 😀", "Flan <b>", "123", "x".repeat(121)]) {
      expect(await alta(malo), JSON.stringify(malo)).toBe("23514");
    }
    expect(await falla(`UPDATE "Producto" SET "nombre" = 'Mila_nesa' WHERE "id" = 'prod_f1'`)).toBe("23514");
    // Razón social y sucursal NO llevan los signos de catálogo; el nombre de un rol exige letra.
    expect(await falla(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_x',$1,'Centro 50%')`, [E])).toBe("23514");
    expect(await falla(`INSERT INTO "Sucursal" ("id","empresaId","nombre") VALUES ('suc_x',$1,'Centro')`, [E])).toBe("sin error");
  });

  it("PARIDAD: la función de la base coincide con el código en miles de textos de borde, para cada ficha", async () => {
    const pool = ["a", "Z", "ñ", "Á", "é", "é", "0", "9", " ", " ", " ", " ", "\t", "\n", "\r", "​", "_", "<", ">", "=", "@", "+", "-", "¿", "¡", "?", "!", "%", "$", ".", ",", "&", "(", ")", "'", "/", "°", "º", "ª", "’", "“", "”", "–", "—", "«", "»", "®", "™", "×", "÷", "Š", "Œ", "ž", "Ÿ", "😀", "я", "א", "#", ";", ":", '"'];
    const corpus = fc.sample(fc.array(fc.constantFrom(...pool), { minLength: 0, maxLength: 12 }).map((a) => a.join("")), { numRuns: 6000, seed: 20261117 });
    corpus.push("x".repeat(80), "x".repeat(81), "x".repeat(120), "x".repeat(121), "x".repeat(200), "x".repeat(201), "Café", "Café", "1+1", "Tu & yo", "50%", "$ 10");
    const fichas = Object.keys(FICHAS_DE_TEXTO) as FichaDeTexto[];
    for (const ficha of fichas) {
      const r = FICHAS_DE_TEXTO[ficha];
      const filas = await q<{ s: string; ok: boolean }>(`SELECT s, nombre_de_ficha_valido(s, $2, $3, $4) AS ok FROM unnest($1::text[]) AS s`, [corpus, r.maximo, r.exigirUnaLetra, r.conSignosDeCatalogo]);
      const distintas = filas.filter((f) => {
        const j = textoDeFichaDesdeTexto(ficha, f.s);
        return f.ok !== (j.ok && j.valor === f.s);
      });
      expect(distintas.slice(0, 5).map((f) => JSON.stringify(f.s)), `ficha ${ficha}`).toEqual([]);
    }
  });

  it("BAJAR: saca los CHECK y la función sin perder nada; bajar dos veces no falla; SUBIR OTRA VEZ deja el catálogo idéntico", async () => {
    await correr("down.sql");
    expect(await catalogo()).toEqual({ funcion: [], checks: [] });
    expect(await falla(`UPDATE "Producto" SET "nombre" = 'Mila_nesa' WHERE "id" = 'prod_f1'`)).toBe("sin error");
    expect(await q(`SELECT count(*)::int AS n FROM "Producto"`)).toEqual([{ n: 1 }]);
    await correr("down.sql");
    await correr("migration.sql");
    expect(await catalogo()).toEqual(primera);
  });
});
