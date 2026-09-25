import { describe, expect, it } from "vitest";
import { interpretarNumero, numeroDelCampo, textoCanonico, tieneALoSumoDecimales } from "@/core/datos/numero-tecleado";

// Sin base de datos: el parser es puro. Tabla de compatibilidad con el `normalizar` que tenía CampoNumero
// (docs/plan-validacion-de-datos-2026-09-25.md): lo que ya andaba da el mismo número; lo que se guardaba mal pasa a ser error.
function valor(texto: string) {
  const r = interpretarNumero(texto);
  if (!r.ok) throw new Error(`esperaba ok para ${JSON.stringify(texto)}: ${r.mensaje}`);
  return r.valor;
}

describe("interpretarNumero — lo que ya andaba da el mismo número", () => {
  it.each([
    ["0", 0],
    ["5", 5],
    ["10", 10],
    ["1000", 1000],
    ["-5", -5],
    ["1,5", 1.5],
    ["1.5", 1.5],
    ["0,07", 0.07],
    ["10,01", 10.01],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["12.345.678,9", 12345678.9],
    ["1.234", 1.234], // ambigüedad a propósito: un solo separador es el decimal
    ["1,234", 1.234],
    ["12,345", 12.345],
    ["  42  ", 42],
    [",5", 0.5], // tecleo a medias
    ["5,", 5],
    ["-,5", -0.5],
    ["007", 7],
  ])("%j → %d", (texto, esperado) => {
    expect(valor(texto)).toBe(esperado);
  });

  it("vacío o solo espacios → null (campo sin cargar)", () => {
    expect(valor("")).toBeNull();
    expect(valor("   ")).toBeNull();
  });

  it("'-0' se interpreta como 0 (nunca -0)", () => {
    expect(Object.is(valor("-0"), 0)).toBe(true);
  });
});

describe("interpretarNumero — se arregla lo que antes daba NaN / 0", () => {
  it.each([
    ["1.000.000", 1_000_000],
    ["1,000,000", 1_000_000],
    ["1.000.000,50", 1_000_000.5],
    ["1,000,000.50", 1_000_000.5],
  ])("%j → %d", (texto, esperado) => {
    expect(valor(texto)).toBe(esperado);
  });
});

describe("interpretarNumero — pasan a ser error de formato (antes se guardaban mal o en 0)", () => {
  it.each([
    "...,.,.,...",
    "1,2,3",
    "1.2.3",
    "1.23,4",
    "1,23.4",
    ".234,5",
    "1.234,5,6",
    "abc",
    "Infinity",
    "-Infinity",
    "NaN",
    "1e3",
    "5-3",
    "--5",
    "-",
    ".",
    ",",
    "$ 100",
    "$100",
    "1 000",
    "10%",
    "+5",
    "0x10",
    "9".repeat(400),
  ])("%j", (texto) => {
    const r = interpretarNumero(texto);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe("formato");
      expect(r.mensaje).toBe("No es un número válido.");
    }
  });
});

describe("textoCanonico — dígitos, un solo punto decimal, sin notación exponencial", () => {
  it.each([
    [0, "0"],
    [5, "5"],
    [-5, "-5"],
    [1234.56, "1234.56"],
    [0.07, "0.07"],
    [1e21, "1000000000000000000000"],
    [1e-7, "0.0000001"],
    [-1.5e-7, "-0.00000015"],
    [1.5e22, "15000000000000000000000"],
  ])("%d → %j", (n, esperado) => {
    expect(textoCanonico(n)).toBe(esperado);
  });

  it("-0 → '0'", () => {
    expect(textoCanonico(-0)).toBe("0");
  });

  it.each([0, 1, -1, 0.07, 10.01, 1234.56, 1_000_000, 12345678.9, 1.2345, 0.0000001, 1e21, 999_999_999_999.99])(
    "ida y vuelta: interpretar el texto canónico de %d da el mismo número",
    (n) => {
      expect(valor(textoCanonico(n))).toBe(n);
    }
  );
});

describe("numeroDelCampo — lo que un formulario manda a la Server Action", () => {
  it("vacío → undefined", () => {
    expect(numeroDelCampo("")).toBeUndefined();
    expect(numeroDelCampo("  ")).toBeUndefined();
  });
  it("válido → el número", () => {
    expect(numeroDelCampo("1234.56")).toBe(1234.56);
    expect(numeroDelCampo("1.000.000")).toBe(1_000_000);
  });
  it("inválido → NaN, nunca 0", () => {
    expect(numeroDelCampo("abc")).toBeNaN();
    expect(numeroDelCampo("...,.,.,...")).toBeNaN();
  });
});

describe("tieneALoSumoDecimales — sin falsos rechazos por ruido de punto flotante", () => {
  it.each([
    [0.07, 2],
    [10.01, 2],
    [19.17, 2],
    [23.33, 2],
    [1.2345, 4],
    [3, 0],
    [1.25, 2],
    [-10.01, 2],
    [999_999_999_999.99, 2],
  ])("%d tiene a lo sumo %d decimales", (n, d) => {
    expect(tieneALoSumoDecimales(n, d)).toBe(true);
  });

  it.each([
    [1.005, 2],
    [12.345, 2],
    [2.5, 0],
    [1.255, 2],
    [1.23456, 4],
  ])("%d tiene más de %d decimales", (n, d) => {
    expect(tieneALoSumoDecimales(n, d)).toBe(false);
  });
});
