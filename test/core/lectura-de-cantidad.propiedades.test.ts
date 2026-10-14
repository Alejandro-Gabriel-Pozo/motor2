import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { leerCantidadTecleada, unidadesDeLectura } from "@/core/catalogo/public";
import { interpretarNumero } from "@/core/datos/numero-tecleado";

/**
 * Propiedades de la lectura en vivo de una cantidad (src/core/catalogo/lectura-de-cantidad.ts). Los textos se arman VÁLIDOS por construcción
 * (dígitos y separadores en las formas que acepta el parser), así cada propiedad dice algo de un caso que el operario puede tipear. Puro: sin base.
 */
const RUNS = { numRuns: 1000 };
const KG = unidadesDeLectura([
  { id: "kg", nombre: "kg", magnitud: "PESO" },
  { id: "g", nombre: "g", magnitud: "PESO" },
]).kg;

const separador = fc.constantFrom(".", ",");
const tresDigitos = fc.integer({ min: 0, max: 999 }).map((n) => String(n).padStart(3, "0"));

function lecturaDe(texto: string) {
  const r = leerCantidadTecleada(texto, KG);
  if (r.tipo !== "valor") throw new Error(`esperaba un valor para ${JSON.stringify(texto)}`);
  return r;
}

describe("lectura de cantidad (propiedades)", () => {
  it("el valor es SIEMPRE el de interpretarNumero (la lectura no reinterpreta)", () => {
    const texto = fc.oneof(
      fc.integer({ min: 0, max: 99_999 }).map(String),
      fc.tuple(fc.integer({ min: 0, max: 9999 }), separador, fc.integer({ min: 0, max: 9999 })).map(([e, s, d]) => `${e}${s}${d}`),
      fc.tuple(fc.integer({ min: 1, max: 999 }), separador, tresDigitos, tresDigitos).map(([a, s, b, c]) => `${a}${s}${b}${s}${c}`)
    );
    fc.assert(
      fc.property(texto, (t) => {
        const parser = interpretarNumero(t);
        expect(parser.ok).toBe(true);
        expect(lecturaDe(t).valor).toBe(parser.ok ? parser.valor : NaN);
      }),
      RUNS
    );
  });

  it("un separador con 1 a 3 dígitos antes y exactamente 3 después siempre avisa, y la alternativa es el número sin el separador", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 999 }), separador, tresDigitos, (entero, sep, decimales) => {
        fc.pre(entero !== 0 || decimales !== "000"); // «0.000» se lee 0 de las dos maneras: no hay nada que aclarar (caso puntual en el test de casos)
        const texto = `${entero}${sep}${decimales}`;
        const sinSeparador = String(Number(`${entero}${decimales}`));
        expect(lecturaDe(texto).advertencia).toContain(`escribilo sin ${sep === "." ? "punto" : "coma"}: ${sinSeparador}.`);
      }),
      RUNS
    );
  });

  it("sin separador, con 1, 2 o 4+ decimales, o con miles bien agrupados, nunca avisa", () => {
    const sinAmbiguedad = fc.oneof(
      fc.integer({ min: 0, max: 10_000_000 }).map(String),
      fc.tuple(fc.integer({ min: 0, max: 9999 }), separador, fc.integer({ min: 0, max: 99 })).map(([e, s, d]) => `${e}${s}${d}`),
      fc.tuple(fc.integer({ min: 0, max: 999 }), separador, fc.integer({ min: 0, max: 9999 })).map(([e, s, d]) => `${e}${s}${String(d).padStart(4, "0")}`),
      fc.tuple(fc.integer({ min: 1, max: 999 }), separador, tresDigitos, tresDigitos).map(([a, s, b, c]) => `${a}${s}${b}${s}${c}`)
    );
    fc.assert(
      fc.property(sinAmbiguedad, (t) => {
        expect(lecturaDe(t).advertencia).toBeNull();
      }),
      RUNS
    );
  });

  it("en kg, un valor entre 0 y 1 se lee en g y vuelve al mismo valor (×1000); de 1 para arriba se lee en kg", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999 }), (milesimos) => {
        const n = milesimos / 1000;
        const { lectura } = lecturaDe(String(n));
        if (n > 0 && n < 1) {
          expect(lectura).toMatch(/^= \d+ g$/);
          expect(Number(lectura.slice(2, -2)) / 1000).toBeCloseTo(n, 9);
        } else {
          expect(lectura.endsWith(" kg")).toBe(true);
        }
        expect(lectura).not.toMatch(/\./); // sin separador de miles ni punto decimal: la lectura nunca es ambigua
      }),
      RUNS
    );
  });
});
