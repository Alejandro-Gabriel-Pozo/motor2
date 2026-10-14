import { Decimal } from "decimal.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { leerFactorDeEscala } from "../../../src/core/opciones/factor-de-escala";
import { FACTOR_DE_ESCALA_MAXIMO } from "../../../src/core/opciones/tipos";
import { esFactorValido } from "../../../src/core/opciones/validar-configuracion";

/**
 * OPCIONES-FACTOR: el factor de un tamaño en palabras. Lo que se fija acá es lo que lee el operario mientras tipea: «1,3 = 30% más», «0,7 = 30% menos», con coma decimal, sin ruido
 * binario (1,3 − 1 no es 0,30000000000000004) y con la MISMA regla de qué factor es válido que el servidor (`esFactorValido`).
 */

function frase(valor: number | null): string {
  const l = leerFactorDeEscala(valor);
  if (!l.valido) throw new Error(`se esperaba un factor válido y vino: ${l.mensaje}`);
  return l.frase;
}

function aviso(valor: number | null): string {
  const l = leerFactorDeEscala(valor);
  if (l.valido) throw new Error(`se esperaba un aviso y vino: ${l.frase}`);
  return l.mensaje;
}

describe("leerFactorDeEscala: los casos que lee el operario", () => {
  it("1 = lo mismo que el tamaño base", () => {
    const l = leerFactorDeEscala(1);
    expect(l).toEqual({ valido: true, factor: 1, factorEnTexto: "1", sentido: "igual", comparacion: "lleva lo mismo que el tamaño base", frase: "Factor 1 = lleva lo mismo que el tamaño base" });
  });

  it("1,3 = 30% más y 0,7 = 30% menos, sin ruido de coma flotante", () => {
    expect(frase(1.3)).toBe("Factor 1,3 = lleva 30% más que el tamaño base");
    expect(frase(0.7)).toBe("Factor 0,7 = lleva 30% menos que el tamaño base");
    expect(leerFactorDeEscala(1.3)).toMatchObject({ sentido: "mas" });
    expect(leerFactorDeEscala(0.7)).toMatchObject({ sentido: "menos" });
    // Los que en `number` dan ruido: 1,1 − 1 = 0,10000000000000009; 0,9 − 1 = −0,09999999999999998.
    expect(frase(1.1)).toBe("Factor 1,1 = lleva 10% más que el tamaño base");
    expect(frase(0.9)).toBe("Factor 0,9 = lleva 10% menos que el tamaño base");
    expect(frase(1.15)).toBe("Factor 1,15 = lleva 15% más que el tamaño base");
  });

  it("los enteros se leen como múltiplos y 0,5 como la mitad, con el porcentaje entre paréntesis", () => {
    expect(frase(2)).toBe("Factor 2 = lleva el doble de lo que lleva el tamaño base (100% más)");
    expect(frase(3)).toBe("Factor 3 = lleva el triple de lo que lleva el tamaño base (200% más)");
    expect(frase(4)).toBe("Factor 4 = lleva 4 veces lo que lleva el tamaño base (300% más)");
    expect(frase(10)).toBe("Factor 10 = lleva 10 veces lo que lleva el tamaño base (900% más)");
    expect(frase(0.5)).toBe("Factor 0,5 = lleva la mitad de lo que lleva el tamaño base (50% menos)");
    // 2,5 no es entero: porcentaje a secas.
    expect(frase(2.5)).toBe("Factor 2,5 = lleva 150% más que el tamaño base");
  });

  it("los bordes: 0,0001 (el mínimo) y 4 decimales", () => {
    expect(frase(0.0001)).toBe("Factor 0,0001 = lleva 99,99% menos que el tamaño base");
    expect(frase(1.0001)).toBe("Factor 1,0001 = lleva 0,01% más que el tamaño base");
    expect(frase(1.2345)).toBe("Factor 1,2345 = lleva 23,45% más que el tamaño base");
    expect(frase(9.9999)).toBe("Factor 9,9999 = lleva 899,99% más que el tamaño base");
    expect(leerFactorDeEscala(1.2345)).toMatchObject({ factorEnTexto: "1,2345", factor: 1.2345 });
  });

  it("vacío: pide el factor, sin porcentaje", () => {
    expect(aviso(null)).toBe("Escribí el factor: 1 = lleva lo mismo que el tamaño base.");
  });

  it("inválidos: un aviso que dice qué está mal (y nunca un porcentaje)", () => {
    expect(aviso(Number.NaN)).toBe("Ese factor no es un número. Escribilo como 1,3 o 0,7.");
    expect(aviso(Number.POSITIVE_INFINITY)).toBe("Ese factor no es un número. Escribilo como 1,3 o 0,7.");
    expect(aviso(0)).toBe("El factor tiene que ser mayor que 0.");
    expect(aviso(-1.3)).toBe("El factor tiene que ser mayor que 0.");
    expect(aviso(10.0001)).toBe("El factor puede ser hasta 10 (10 veces lo que lleva el tamaño base).");
    // «1.300» con punto se lee como mil trescientos: el aviso del tope lo hace evidente.
    expect(aviso(1300)).toBe("El factor puede ser hasta 10 (10 veces lo que lleva el tamaño base).");
    expect(aviso(1.23456)).toBe("El factor lleva hasta 4 decimales.");
    expect(aviso(0.00001)).toBe("El factor lleva hasta 4 decimales.");
  });
});

/** Un factor válido POR CONSTRUCCIÓN: un entero de diezmilésimos entre 1 y 100.000 (0,0001 a 10). */
const diezmilesimos = fc.integer({ min: 1, max: FACTOR_DE_ESCALA_MAXIMO * 10_000 });
const deDiezmilesimos = (n: number) => Number((n / 10_000).toFixed(4));

describe("leerFactorDeEscala: propiedades", () => {
  it("es válido exactamente cuando el servidor lo aceptaría (`esFactorValido`), para cualquier número", () => {
    fc.assert(
      fc.property(fc.oneof(fc.double({ noNaN: false }), diezmilesimos.map(deDiezmilesimos)), (f) => {
        expect(leerFactorDeEscala(f).valido).toBe(esFactorValido(f));
      }),
    );
  });

  it("con un factor válido, el porcentaje de la frase es |f − 1| × 100 en decimal exacto, y el sentido el de f frente a 1", () => {
    fc.assert(
      fc.property(diezmilesimos, (n) => {
        const f = deDiezmilesimos(n);
        const l = leerFactorDeEscala(f);
        if (!l.valido) throw new Error(`${f} tendría que ser válido`);
        const esperado = new Decimal(n - 10_000).abs().dividedBy(100).toFixed().replace(".", ",");
        expect(l.sentido).toBe(n === 10_000 ? "igual" : n > 10_000 ? "mas" : "menos");
        if (n !== 10_000) expect(l.comparacion).toContain(`${esperado}%`);
        expect(l.factorEnTexto).toBe(new Decimal(n).dividedBy(10_000).toFixed().replace(".", ","));
        expect(l.frase).toBe(`Factor ${l.factorEnTexto} = ${l.comparacion}`);
        // Nunca el punto decimal ni la notación científica en lo que lee el operario.
        expect(l.frase).not.toMatch(/\d\.\d|e[+-]?\d/);
      }),
    );
  });
});
