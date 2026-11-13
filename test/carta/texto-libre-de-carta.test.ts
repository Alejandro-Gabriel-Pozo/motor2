import { describe, expect, it } from "vitest";
import { validarTextoLibreCarta } from "../../src/core/carta/validaciones";

/**
 * Oráculo del texto libre de la carta (paso 2 de la auditoría 2026-11-12; regla «todo nace cerrado», AGENTS.md 2026-11-11): `validarTextoLibreCarta` declara lo PERMITIDO (letras, marcas, números,
 * puntuación, símbolos y espacios; el salto de línea solo en las áreas de texto), no lo prohibido. Todo texto libre termina en la carta pública, así que los caracteres de control, de ancho cero y de
 * dirección de texto (que permiten falsificar cómo se lee un título) no entran.
 */
const UNA_LINEA = (v: unknown) => validarTextoLibreCarta(v, "El título", 40);
const VARIAS = (v: unknown, maximo = 40) => validarTextoLibreCarta(v, "La descripción", maximo, { multilinea: true });

describe("validarTextoLibreCarta: una línea", () => {
  const aceptados: Array<[string, string]> = [
    ["Milanesa con papas", "Milanesa con papas"],
    ["  Menú del día  ", "Menú del día"],
    ["Ñandú al disco — 100% casero (nuevo)!", "Ñandú al disco — 100% casero (nuevo)!"],
    ["¿Querés papas? $500 #1 @casa", "¿Querés papas? $500 #1 @casa"],
    ["Café ☕ ★ 🍕", "Café ☕ ★ 🍕"],
    ["é (e con tilde combinada)", "é (e con tilde combinada)"],
    ["Plato del día", "Plato del día"],
  ];
  it.each(aceptados)("acepta %j", (entrada, esperado) => {
    expect(UNA_LINEA(entrada)).toEqual({ ok: true, valor: esperado });
  });

  it("vacío o solo espacios es «sin texto» (null), no un error", () => {
    expect(UNA_LINEA("")).toEqual({ ok: true, valor: null });
    expect(UNA_LINEA("   ")).toEqual({ ok: true, valor: null });
    expect(UNA_LINEA(null)).toEqual({ ok: true, valor: null });
    expect(UNA_LINEA(undefined)).toEqual({ ok: true, valor: null });
  });

  const rechazados: Array<[string, string]> = [
    ["dirección de texto (bidi) que invierte cómo se lee", "Oferta ‮odaf"],
    ["aislador de dirección", "a⁦b⁩"],
    ["espacio de ancho cero", "pre​cio"],
    ["unidor de ancho cero (también el de un emoji compuesto)", "👨‍🍳"],
    ["carácter de orden de bytes dentro del texto", "a﻿b"],
    ["NUL (rompe la base)", "a\u0000b"],
    ["tabulación", "a\tb"],
    ["escape", "a\u001Bb"],
    ["salto de línea en un texto de una línea", "a\nb"],
    ["retorno de carro", "a\rb"],
    ["separador de línea Unicode", "a b"],
    ["separador de párrafo Unicode", "a b"],
    ["carácter de control C1", "a\u0085b"],
    ["carácter privado", "ab"],
    ["mitad suelta de un emoji", "a\uD83Db"],
  ];
  it.each(rechazados)("rechaza %s", (_motivo, entrada) => {
    const r = UNA_LINEA(entrada);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.mensaje).toMatch(/caracteres no permitidos/);
  });

  it("respeta el largo máximo y lo dice antes que el juego de caracteres", () => {
    expect(UNA_LINEA("x".repeat(40))).toEqual({ ok: true, valor: "x".repeat(40) });
    const r = UNA_LINEA("x".repeat(41));
    expect(r).toEqual({ ok: false, mensaje: expect.stringMatching(/40/) });
  });
});

describe("validarTextoLibreCarta: varias líneas (áreas de texto)", () => {
  it("acepta saltos de línea y guarda siempre `\\n` (el navegador manda `\\r\\n`)", () => {
    expect(VARIAS("Línea 1\nLínea 2")).toEqual({ ok: true, valor: "Línea 1\nLínea 2" });
    expect(VARIAS("Línea 1\r\nLínea 2")).toEqual({ ok: true, valor: "Línea 1\nLínea 2" });
    expect(VARIAS("Línea 1\rLínea 2")).toEqual({ ok: true, valor: "Línea 1\nLínea 2" });
  });

  it("sigue rechazando controles, ancho cero y dirección de texto, también entre líneas", () => {
    for (const entrada of ["a‮b\nc", "a\nb​c", "a\u0000\nb", "a\tb\nc", "a b"]) {
      const r = VARIAS(entrada);
      expect(r.ok, JSON.stringify(entrada)).toBe(false);
      if (!r.ok) expect(r.mensaje).toMatch(/caracteres no permitidos/);
    }
  });

  it("el largo se mide después de normalizar los saltos: «\\r\\n» cuenta una vez", () => {
    expect(VARIAS("a\r\nb", 3)).toEqual({ ok: true, valor: "a\nb" });
    expect(VARIAS("a\r\nb", 2).ok).toBe(false);
  });

  it("vacío o solo saltos de línea es «sin texto» (null)", () => {
    expect(VARIAS("")).toEqual({ ok: true, valor: null });
    expect(VARIAS("\r\n \n")).toEqual({ ok: true, valor: null });
  });
});
