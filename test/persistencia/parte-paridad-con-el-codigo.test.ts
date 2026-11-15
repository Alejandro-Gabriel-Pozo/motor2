import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { cuitDesdeTexto, digitoVerificadorDeCuit } from "../../src/core/fiscal/cuit-estricto";
import { textoDeFichaDesdeTexto } from "../../src/core/datos/fichas-de-texto";
import { prismaAdmin } from "../setup/test-db";

/**
 * Parte P1: PARIDAD entre las reglas de la base y las del código (docs/diseno-parte-2026-11-12.md §8.1, T-7): el CHECK y el validador no se pueden separar sin que este test lo note.
 *  · `cuit_valido(text)` (SQL) contra `cuitDesdeTexto` (código, módulo 11 SIN lista de prefijos): miles de casos generados, entre ellos los de dígito verificador correcto y las formas que ninguna acepta.
 *  · `texto_de_ficha_valido(text, 200)` más «al menos una letra» (SQL, el CHECK del nombre) contra la ficha RAZON_SOCIAL (código), sobre textos YA canónicos (la base no colapsa espacios: lo hace el código).
 * Con semilla fija: una falla se reproduce.
 */
afterAll(() => prismaAdmin.$disconnect());

const sqlLista = <T>(consulta: string, valores: string[]) => prismaAdmin.$queryRawUnsafe<Array<{ r: T }>>(consulta, valores).then((f) => f.map((x) => x.r));

describe("paridad SQL ↔ código", () => {
  it("cuit_valido (SQL) coincide con la regla de CUIT del código en 6.000 casos", async () => {
    const dig = fc.integer({ min: 0, max: 9 }).map(String);
    const diezDigitos = fc.array(dig, { minLength: 10, maxLength: 10 }).map((d) => d.join(""));
    const conVerificador = diezDigitos.map((d) => { const v = digitoVerificadorDeCuit(d); return v === null ? `${d}0` : `${d}${v}`; });
    const casos = [
      ...fc.sample(conVerificador, { numRuns: 2500, seed: 11 }),
      ...fc.sample(fc.array(dig, { minLength: 11, maxLength: 11 }).map((d) => d.join("")), { numRuns: 2500, seed: 12 }),
      ...fc.sample(fc.string({ minLength: 0, maxLength: 14 }), { numRuns: 1000, seed: 13 }),
      "", "20-12345678-6", " 20123456786", "2012345678", "201234567860", "２０１２３４５６７８６", "20123456786\n",
    ];
    const sql = await sqlLista<boolean>(`SELECT cuit_valido(x) AS r FROM unnest($1::text[]) WITH ORDINALITY AS t(x, i) ORDER BY i`, casos);
    expect(sql).toHaveLength(casos.length);
    // La base solo acepta la forma canónica (11 dígitos); el código además acepta XX-XXXXXXXX-X, que la pantalla normaliza antes de guardar.
    const esperado = casos.map((c) => /^[0-9]{11}$/.test(c) && cuitDesdeTexto(c).ok);
    const distintos = casos.map((c, i) => ({ c, sql: sql[i], codigo: esperado[i] })).filter((x) => x.sql !== x.codigo);
    expect(distintos).toEqual([]);
    expect(sql.filter(Boolean).length, "el generador produjo CUIT válidos e inválidos").toBeGreaterThan(1000);
    expect(sql.filter((x) => !x).length).toBeGreaterThan(1000);
  });

  it("el nombre: el CHECK de la base y la ficha RAZON_SOCIAL del código dicen lo mismo sobre 8.000 textos canónicos", async () => {
    const unidad = fc.constantFrom(..."aZñÁüÿ09 .,&-'/()°+:;\"#ºª’“”–—«»®™¿¡?!%$_<>=@*\\|{}[]~^`\t\n‮​×÷😀א".split(""), "ab", " ", "Cía", "S.R.L.");
    const crudos = fc.sample(fc.array(unidad, { minLength: 0, maxLength: 10 }).map((p) => p.join("")), { numRuns: 8000, seed: 21 });
    const canonico = (t: string) => t.trim().normalize("NFC").replace(/\p{Zs}+/gu, " ");
    const casos = [...new Set(crudos.filter((t) => t !== "" && canonico(t) === t).concat(["Pérez & Hijos S.R.L.", "12345", "- Sur", "Sur_", "x".repeat(200), "x".repeat(201), "Ä".repeat(200)]))];
    const sql = await sqlLista<boolean>(
      `SELECT (texto_de_ficha_valido(x, 200) AND x ~ '[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ]') AS r FROM unnest($1::text[]) WITH ORDINALITY AS t(x, i) ORDER BY i`,
      casos,
    );
    const distintos = casos.map((c, i) => ({ c, sql: sql[i], codigo: textoDeFichaDesdeTexto("RAZON_SOCIAL", c).ok })).filter((x) => x.sql !== x.codigo);
    expect(distintos).toEqual([]);
    expect(sql.filter(Boolean).length).toBeGreaterThan(100);
    expect(sql.filter((x) => !x).length).toBeGreaterThan(100);
  });
});
