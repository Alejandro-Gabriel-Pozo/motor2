import { describe, expect, it } from "vitest";
import * as modulo from "../../src/core/formato-de-numero";
import {
  CASOS_ESCRITOS,
  DECIMALES_DE_UNIDAD,
  EXPORTACIONES_DECLARADAS,
  MAGNITUDES,
  SIGNOS,
  SIN_DATO,
  TIPOS,
  VACIOS,
  referencia,
  type Tipo,
} from "./formato-de-numero.oraculo";

/**
 * Formateo de salida de números: todas las combinaciones contra el oráculo (`formato-de-numero.oraculo.ts`, escrito aparte del código; regla del dueño, 2026-11-09).
 * Dimensiones: tipo × valor × decimales de la unidad × signo × vacío. No necesita base.
 */
function formatear(tipo: Tipo, n: number | null | undefined, decimales: number | undefined, unidad: string): string {
  switch (tipo) {
    case "dinero":
      return modulo.formatearMonto(n);
    case "cantidad":
      return modulo.formatearCantidad(n, decimales);
    case "cantidad-con-unidad":
      return modulo.formatearCantidadConUnidad(n, unidad, decimales);
    case "entero":
      return modulo.formatearEntero(n);
    case "porcentaje":
      return modulo.formatearPorcentaje(n);
  }
}

describe("formateo de salida de números: guardián de dimensiones", () => {
  it("el módulo exporta exactamente lo declarado en el oráculo (una función o constante nueva sin declarar falla)", () => {
    expect(Object.keys(modulo).sort()).toEqual(Object.keys(EXPORTACIONES_DECLARADAS).sort());
  });

  it("formatearDolares: siempre 2 decimales, sin símbolo, punto de miles, «—» sin dato; IMPORTE_MINIMO_TEXTO es «$ 0,01»", () => {
    expect(modulo.formatearDolares(1234.5)).toBe("1.234,50");
    expect(modulo.formatearDolares(0)).toBe("0,00");
    expect(modulo.formatearDolares(-5)).toBe("-5,00");
    expect(modulo.formatearDolares(1.005)).toBe("1,01");
    expect(modulo.formatearDolares(null)).toBe(SIN_DATO);
    expect(modulo.IMPORTE_MINIMO_TEXTO).toBe("$\u00a00,01");
  });

  it("SIN_DATO es «—»", () => {
    expect(modulo.SIN_DATO).toBe(SIN_DATO);
  });
});

describe("formateo de salida de números: la tabla de casos escritos", () => {
  it.each(CASOS_ESCRITOS)("%s de %s (decimales %s, unidad «%s») = «%s»", (tipo, valor, decimales, unidad, esperado) => {
    expect(formatear(tipo, valor, decimales, unidad)).toBe(esperado);
  });
});

describe("formateo de salida de números: todas las combinaciones contra el oráculo", () => {
  const combinaciones = TIPOS.flatMap((tipo) =>
    MAGNITUDES.flatMap((magnitud) => SIGNOS.flatMap((signo) => DECIMALES_DE_UNIDAD.map((decimales) => ({ tipo, magnitud, signo, decimales })))),
  );

  it("recorre las combinaciones declaradas (5 tipos × 18 magnitudes × 2 signos × 5 decimales)", () => {
    expect(combinaciones).toHaveLength(5 * MAGNITUDES.length * 2 * 5);
  });

  it("valor × tipo × decimales de la unidad × signo: lo que sale es lo que dice el oráculo", () => {
    const distintas: string[] = [];
    for (const { tipo, magnitud, signo, decimales } of combinaciones) {
      const n = Number(`${signo === "-" ? "-" : ""}${magnitud}`);
      const obtenido = formatear(tipo, n, decimales, "kg");
      const esperado = referencia(tipo, magnitud, signo, decimales, "kg");
      if (obtenido !== esperado) distintas.push(`${tipo} ${signo}${magnitud} (decimales ${decimales}): salió «${obtenido}», el oráculo dice «${esperado}»`);
    }
    expect(distintas).toEqual([]);
  });

  it("vacío × tipo: null, undefined, NaN e infinitos salen «—», nunca un 0 inventado", () => {
    for (const tipo of TIPOS) for (const vacio of VACIOS) expect(formatear(tipo, vacio, 3, "kg"), `${tipo} ${String(vacio)}`).toBe(SIN_DATO);
  });

  it("-0 sale como 0, sin signo", () => {
    for (const tipo of TIPOS) expect(formatear(tipo, -0, 3, "kg"), tipo).toBe(referencia(tipo, "0", "+", 3, "kg"));
  });

  it("decimales de unidad inválidos (negativo, no entero, más de 6) caen en los de «sin unidad conocida» (4)", () => {
    for (const malos of [-1, 1.5, 7, Number.NaN]) expect(modulo.formatearCantidad(1.23456, malos)).toBe(modulo.formatearCantidad(1.23456, undefined));
  });
});
