import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatearNumeroComprobante, leerNumeroComprobante, type NumeroComprobante } from "../../src/core/datos/numero-comprobante";

/**
 * Tests basados en propiedades (fast-check) de src/core/datos/numero-comprobante.ts (Etapa A, punto 5). Funciones puras, sin Postgres:
 * el archivo entero corre en milisegundos. Mismo estilo que moneda.propiedades.test.ts.
 */

const RUNS = { numRuns: 1000 };

const puntoDeVenta = fc.integer({ min: 1, max: 99999 });
const numero = fc.integer({ min: 1, max: 99999999 });
const letra = fc.constantFrom("A", "B", "C", "E", "M", null);
const normalizado = fc.record({ tipo: fc.constant("NORMALIZADO" as const), letra, puntoDeVenta, numero });

/** Escribe el mismo comprobante de muchas maneras (con ceros de más o de menos, letra en minúscula, separadores). */
const escritura = fc
  .record({
    pv: puntoDeVenta,
    nro: numero,
    letra: fc.constantFrom("A", "B", "C", "E", "M", "a", "c", "e", "m", ""),
    separador: fc.constantFrom("", " ", "-", " - "),
    ceroPv: fc.integer({ min: 0, max: 3 }),
    ceroNro: fc.integer({ min: 0, max: 3 }),
    borde: fc.constantFrom("", " ", "  "),
  })
  .map((e) => `${e.borde}${e.letra}${e.letra ? e.separador : ""}${"0".repeat(e.ceroPv)}${e.pv}-${"0".repeat(e.ceroNro)}${e.nro}${e.borde}`);

/** Cualquier texto Unicode, incluidos emojis, sustitutos sueltos y caracteres de control. */
const textoCualquiera = fc.oneof(fc.string({ unit: "binary", maxLength: 80 }), fc.string({ unit: "grapheme", maxLength: 80 }), fc.string({ maxLength: 80 }));

describe("número de comprobante (propiedades)", () => {
  it("ida y vuelta: leer lo formateado da el mismo valor", () => {
    fc.assert(
      fc.property(normalizado, (v: NumeroComprobante) => {
        expect(leerNumeroComprobante(formatearNumeroComprobante(v))).toEqual(v);
      }),
      RUNS,
    );
  });

  it("el largo canónico sin letra es 5 + 1 + 8 y con letra, 2 más", () => {
    fc.assert(
      fc.property(puntoDeVenta, numero, (pv, nro) => {
        const sinLetra = formatearNumeroComprobante({ tipo: "NORMALIZADO", letra: null, puntoDeVenta: pv, numero: nro });
        expect(sinLetra).toMatch(/^\d{5}-\d{8}$/);
        expect(sinLetra.length).toBe(14);
        const conLetra = formatearNumeroComprobante({ tipo: "NORMALIZADO", letra: "A", puntoDeVenta: pv, numero: nro });
        expect(conLetra).toMatch(/^A \d{5}-\d{8}$/);
        expect(conLetra.length).toBe(16);
      }),
      RUNS,
    );
  });

  it("leer cualquier escritura válida da el mismo valor que leer su forma canónica", () => {
    fc.assert(
      fc.property(escritura, (texto) => {
        const leido = leerNumeroComprobante(texto);
        expect(leido.tipo).toBe("NORMALIZADO");
        expect(leerNumeroComprobante(formatearNumeroComprobante(leido))).toEqual(leido);
      }),
      RUNS,
    );
  });

  it("es idempotente: formatear dos veces es formatear una (con cualquier texto)", () => {
    fc.assert(
      fc.property(fc.oneof(escritura, textoCualquiera), (texto) => {
        const una = formatearNumeroComprobante(leerNumeroComprobante(texto));
        const dos = formatearNumeroComprobante(leerNumeroComprobante(una));
        expect(dos).toBe(una);
      }),
      RUNS,
    );
  });

  it("lo libre conserva el texto tal cual (sin recortar ni cambiar mayúsculas) y nunca falla con cualquier texto", () => {
    fc.assert(
      fc.property(textoCualquiera, (texto) => {
        const leido = leerNumeroComprobante(texto);
        if (leido.tipo === "LIBRE") {
          expect(leido.texto).toBe(texto);
          expect(formatearNumeroComprobante(leido)).toBe(texto);
        } else {
          expect(formatearNumeroComprobante(leido)).toMatch(/^([ABCEM] )?\d{5}-\d{8}$/);
        }
      }),
      RUNS,
    );
  });

  it("un texto con letras que no son de comprobante, con espacios de más o en mayúsculas/minúsculas mezcladas queda idéntico", () => {
    for (const texto of ["  BIEN-0001  ", "bien-1234", "E2E-F-1700000000000", "Fc 1-1234", "X 0001-00001234", "1-1234-5", "1 2", "", "   ", "-", "1-", "-1"]) {
      expect(formatearNumeroComprobante(leerNumeroComprobante(texto))).toBe(texto);
    }
  });

  it("casos puntuales: fuera de rango o en cero queda libre; dentro del rango se normaliza", () => {
    expect(leerNumeroComprobante("00000-1")).toEqual({ tipo: "LIBRE", texto: "00000-1" });
    expect(leerNumeroComprobante("1-0")).toEqual({ tipo: "LIBRE", texto: "1-0" });
    expect(leerNumeroComprobante("123456-1")).toEqual({ tipo: "LIBRE", texto: "123456-1" });
    expect(leerNumeroComprobante("1-123456789")).toEqual({ tipo: "LIBRE", texto: "1-123456789" });
    expect(leerNumeroComprobante("BIEN-1")).toEqual({ tipo: "LIBRE", texto: "BIEN-1" });
    expect(leerNumeroComprobante("99999-99999999")).toEqual({ tipo: "NORMALIZADO", letra: null, puntoDeVenta: 99999, numero: 99999999 });
    expect(leerNumeroComprobante("1-1234")).toEqual({ tipo: "NORMALIZADO", letra: null, puntoDeVenta: 1, numero: 1234 });
    expect(formatearNumeroComprobante(leerNumeroComprobante("1-1234"))).toBe("00001-00001234");
    expect(formatearNumeroComprobante(leerNumeroComprobante("0001-00001234"))).toBe("00001-00001234");
    expect(formatearNumeroComprobante(leerNumeroComprobante("A 0001-00001234"))).toBe("A 00001-00001234");
    expect(formatearNumeroComprobante(leerNumeroComprobante("a-0001-00001234"))).toBe("A 00001-00001234");
    expect(formatearNumeroComprobante(leerNumeroComprobante("c0001-00001234"))).toBe("C 00001-00001234");
  });

  it("un número de más de 300 dígitos no rompe (queda libre)", () => {
    const enorme = `1-${"9".repeat(400)}`;
    expect(leerNumeroComprobante(enorme)).toEqual({ tipo: "LIBRE", texto: enorme });
  });
});
