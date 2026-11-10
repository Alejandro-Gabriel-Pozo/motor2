import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { leerCantidadTecleada, unidadesDeLectura } from "@/core/catalogo/public";
import { CONTEXTO_CANTIDAD_SIN_UNIDAD, interpretarNumeroTecleado } from "@/core/datos/numero-tecleado";

/**
 * Propiedades de la lectura en vivo de una cantidad (src/core/catalogo/lectura-de-cantidad.ts). Los textos se arman VÁLIDOS por construcción
 * (dígitos y UNA coma, lo único que acepta el parser desde la regla de números 2026-11-09), así cada propiedad dice algo de un caso que el operario puede tipear. Puro: sin base.
 */
const RUNS = { numRuns: 1000 };
const KG = unidadesDeLectura([
  { id: "kg", nombre: "kg", magnitud: "PESO" },
  { id: "g", nombre: "g", magnitud: "PESO" },
]).kg;
const CONTEXTO_KG = CONTEXTO_CANTIDAD_SIN_UNIDAD;

const tresDigitos = fc.integer({ min: 0, max: 999 }).map((n) => String(n).padStart(3, "0"));

function lecturaDe(texto: string) {
  const r = leerCantidadTecleada(texto, KG);
  if (r.tipo !== "valor") throw new Error(`esperaba un valor para ${JSON.stringify(texto)}`);
  return r;
}

describe("lectura de cantidad (propiedades)", () => {
  it("el valor es SIEMPRE el del parser con los decimales de la unidad (la lectura no reinterpreta)", () => {
    const texto = fc.oneof(
      fc.integer({ min: 0, max: 99_999 }).map(String),
      fc.tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 99 })).map(([e, d]) => `${e},${d}`),
      fc.tuple(fc.integer({ min: 1, max: 999 }), tresDigitos, tresDigitos).map(([a, b, c]) => `${a}${b}${c}`)
    );
    fc.assert(
      fc.property(texto, (t) => {
        const parser = interpretarNumeroTecleado(t, CONTEXTO_KG);
        expect(parser.ok).toBe(true);
        expect(lecturaDe(t).valor).toBe(parser.ok ? parser.valor : NaN);
      }),
      RUNS
    );
  });

  // regla de números 2026-11-09: antes «1.205» era ambiguo (miles o decimal); ahora CUALQUIER punto es el aviso de la coma, nunca se adivina.
  it("cualquier texto con un punto es inválido con el aviso de la coma, sin importar cuántas cifras haya antes o después", () => {
    const conPunto = fc.oneof(
      fc.tuple(fc.integer({ min: 0, max: 999 }), tresDigitos).map(([e, d]) => `${e}.${d}`),
      fc.tuple(fc.integer({ min: 0, max: 99_999 }), fc.integer({ min: 0, max: 99 })).map(([e, d]) => `${e}.${d}`),
      fc.tuple(fc.integer({ min: 1, max: 999 }), tresDigitos, tresDigitos).map(([a, b, c]) => `${a}.${b}.${c}`),
      fc.tuple(fc.integer({ min: 1, max: 999 }), tresDigitos, fc.integer({ min: 0, max: 99 })).map(([a, b, c]) => `${a}.${b},${c}`)
    );
    fc.assert(
      fc.property(conPunto, (t) => {
        expect(leerCantidadTecleada(t, KG)).toEqual({ tipo: "invalido", mensaje: "Los decimales van con coma: 0,5" });
      }),
      RUNS
    );
  });

  it("con coma o sin separador, siempre se entiende", () => {
    const sinAmbiguedad = fc.oneof(
      fc.integer({ min: 0, max: 10_000_000 }).map(String),
      fc.tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 999 })).map(([e, d]) => `${e},${String(d).padStart(3, "0")}`),
      fc.tuple(fc.integer({ min: 1, max: 999 }), tresDigitos, tresDigitos).map(([a, b, c]) => `${a}${b}${c}`)
    );
    fc.assert(
      fc.property(sinAmbiguedad, (t) => {
        expect(leerCantidadTecleada(t, KG).tipo).toBe("valor");
      }),
      RUNS
    );
  });

  it("en kg, un valor entre 0 y 1 se lee en g y vuelve al mismo valor (×1000); de 1 para arriba se lee en kg", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999 }), (milesimos) => {
        const n = milesimos / 1000;
        const { lectura } = lecturaDe(String(n).replace(".", ","));
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
