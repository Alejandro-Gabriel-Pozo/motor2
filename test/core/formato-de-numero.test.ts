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

describe("dinero de la carta pública (decisión del dueño 2026-11-10: el «,00» solo si hay decimales que mostrar)", () => {
  const NBSP = "\u00a0";
  it("casos escritos: entero sin decimales; con centavos, siempre 2; nunca 1 decimal; redondea como el dinero; sin dato «—»", () => {
    const esperado: [number | null | undefined, string][] = [
      [0, "$" + NBSP + "0"],
      [0.01, "$" + NBSP + "0,01"],
      [0.5, "$" + NBSP + "0,50"],
      [1, "$" + NBSP + "1"],
      [999.99, "$" + NBSP + "999,99"],
      [1000, "$" + NBSP + "1.000"],
      [15000, "$" + NBSP + "15.000"],
      [128500, "$" + NBSP + "128.500"],
      [128500.5, "$" + NBSP + "128.500,50"],
      [1234.5, "$" + NBSP + "1.234,50"],
      [1.005, "$" + NBSP + "1,01"],
      [0.004, "$" + NBSP + "0"],
      [999.995, "$" + NBSP + "1.000"],
      [-5, "-$" + NBSP + "5"],
      [-0.5, "-$" + NBSP + "0,50"],
      [-0.001, "$" + NBSP + "0"],
      [null, SIN_DATO],
      [undefined, SIN_DATO],
      [Number.NaN, SIN_DATO],
      [Number.POSITIVE_INFINITY, SIN_DATO],
    ];
    for (const [valor, texto] of esperado) expect(modulo.formatearMontoCarta(valor), "formatearMontoCarta(" + String(valor) + ")").toBe(texto);
  });

  it("todas las magnitudes × signos: es el oráculo del dinero con el «,00» final quitado (y solo ese)", () => {
    const distintas: string[] = [];
    for (const magnitud of MAGNITUDES) {
      for (const signo of SIGNOS) {
        const n = Number((signo === "-" ? "-" : "") + magnitud);
        const dinero = referencia("dinero", magnitud, signo, undefined);
        const esperado = dinero.endsWith(",00") ? dinero.slice(0, -3) : dinero;
        const obtenido = modulo.formatearMontoCarta(n);
        if (obtenido !== esperado) distintas.push(signo + magnitud + ": salió «" + obtenido + "», el oráculo dice «" + esperado + "»");
        // Nunca un solo decimal: o ninguno o dos.
        expect(/,\d$/.test(obtenido), signo + magnitud + " con un solo decimal: «" + obtenido + "»").toBe(false);
      }
    }
    expect(distintas).toEqual([]);
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
