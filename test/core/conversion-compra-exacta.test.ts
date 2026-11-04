import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { convertirCantidadAUnidadDeStock, precioPorUnidad, redondearACantidadDeUnidad } from "../../src/core/movimientos/transiciones";

/**
 * Conversión de una compra (unidad de compra → unidad de stock) y precios por unidad en decimal EXACTO
 * (`convertirCantidadAUnidadDeStock`, `precioPorUnidad`, src/core/movimientos/transiciones.ts).
 *
 * ORÁCULO INDEPENDIENTE: la aritmética de abajo es con `BigInt` en enteros escalados (nada de `number` ni de decimal.js), escrita aparte
 * del código bajo prueba. Un valor decimal se representa como un entero y una escala (`{ n, escala }` = n / 10^escala); el producto y la
 * división son de enteros y el redondeo es una división entera con resto explícito.
 *
 * Reglas que fija este archivo:
 *  - cantidad de stock = cantidad comprada × factor, redondeada a los decimales de la unidad con empate HACIA +∞ (la misma regla que
 *    tenía `Math.round`: 0,125 → 0,13; −0,125 → −0,12);
 *  - precio por unidad = precio total ÷ cantidad, a 4 decimales con empate ALEJÁNDOSE DEL CERO (como `NUMERIC` de Postgres).
 */

// ---------------------------------------------------------------- oráculo (BigInt, sin float, sin decimal.js)

interface Escalado {
  n: bigint;
  escala: number;
}

/** 10^e en BigInt, multiplicando (el `target` del proyecto no admite literales `10n` ni `**` sobre bigint). */
function potenciaDeDiez(e: number): bigint {
  let r = BigInt(1);
  for (let i = 0; i < e; i++) r *= BigInt(10);
  return r;
}
const POTENCIA = potenciaDeDiez;

/** "123.4500" → { n: 1234500, escala: 4 } (n es un bigint) — lee el texto, nunca pasa por `number`. */
function leer(texto: string): Escalado {
  const negativo = texto.startsWith("-");
  const [entera, fraccion = ""] = (negativo ? texto.slice(1) : texto).split(".");
  const n = BigInt(entera + fraccion);
  return { n: negativo ? -n : n, escala: fraccion.length };
}

/** Escalado → texto decimal ("-0.12"), para volver a `number` con `Number(texto)` (la conversión correcta del texto más cercano). */
function aTexto({ n, escala }: Escalado): string {
  const negativo = n < BigInt(0);
  const digitos = (negativo ? -n : n).toString().padStart(escala + 1, "0");
  const entera = digitos.slice(0, digitos.length - escala);
  const fraccion = digitos.slice(digitos.length - escala);
  return `${negativo ? "-" : ""}${entera}${escala > 0 ? "." + fraccion : ""}`;
}

/** Cociente entero hacia −∞ y su resto (0 ≤ resto < divisor), para divisor > 0. */
function divisionPiso(dividendo: bigint, divisor: bigint): { q: bigint; r: bigint } {
  let q = dividendo / divisor; // trunca hacia 0
  let r = dividendo % divisor;
  if (r < BigInt(0)) {
    q -= BigInt(1);
    r += divisor;
  }
  return { q, r };
}

/** Pasa `v` a `decimales` decimales con empate hacia +∞ (el empate exacto sube; con resto ≥ la mitad, sube). */
function aDecimalesEmpateHaciaMasInfinito(v: Escalado, decimales: number): Escalado {
  if (v.escala <= decimales) return { n: v.n * POTENCIA(decimales - v.escala), escala: decimales };
  const paso = POTENCIA(v.escala - decimales);
  const { q, r } = divisionPiso(v.n, paso);
  return { n: q + (BigInt(2) * r >= paso ? BigInt(1) : BigInt(0)), escala: decimales };
}

function oraculoCantidadDeStock(cantidad: string, factor: string, decimales: number): number {
  const a = leer(cantidad);
  const b = leer(factor);
  const producto: Escalado = { n: a.n * b.n, escala: a.escala + b.escala };
  return Number(aTexto(aDecimalesEmpateHaciaMasInfinito(producto, decimales)));
}

/** precioTotal (≥ 0) ÷ cantidad (> 0) a 4 decimales, empate alejándose del cero (para positivos: el resto ≥ mitad sube). */
function oraculoPrecioPorUnidad(precioTotal: string, cantidad: string): number {
  const p = leer(precioTotal);
  const c = leer(cantidad);
  if (p.n <= BigInt(0) || c.n <= BigInt(0)) return 0;
  // (p.n / 10^p.escala) / (c.n / 10^c.escala) × 10^4 = p.n × 10^(c.escala + 4) / (c.n × 10^p.escala)
  const numerador = p.n * POTENCIA(c.escala + 4);
  const denominador = c.n * POTENCIA(p.escala);
  const { q, r } = divisionPiso(numerador, denominador);
  return Number(aTexto({ n: q + (BigInt(2) * r >= denominador ? BigInt(1) : BigInt(0)), escala: 4 }));
}

// ---------------------------------------------------------------- generadores (todo se genera como texto decimal exacto)

/** Entero escalado → texto, con `escala` decimales. */
const textoDe = (n: bigint, escala: number) => aTexto({ n, escala });

/** Cantidad comprada: > 0, hasta 4 decimales (la columna es Decimal(14,4)). */
const arbCantidad = fc.tuple(fc.bigInt({ min: BigInt(1), max: BigInt(99_999_999) }), fc.integer({ min: 0, max: 4 })).map(([n, e]) => textoDe(n, e));
/** Factor de conversión: > 0, hasta 4 decimales (Decimal(14,4)). */
const arbFactor = fc.tuple(fc.bigInt({ min: BigInt(1), max: BigInt(999_999_999) }), fc.integer({ min: 0, max: 4 })).map(([n, e]) => textoDe(n, e));
/** Decimales de la unidad de stock: 0 a 6 (`Unidad.decimales`). */
const arbDecimales = fc.integer({ min: 0, max: 6 });
/** Precio total: de 0,01 a 99.999.999,99, 2 decimales. */
const arbPrecioTotal = fc.bigInt({ min: BigInt(1), max: BigInt(9_999_999_999) }).map((c) => textoDe(c, 2));

const RUNS = { numRuns: 3000 };

// ---------------------------------------------------------------- lo que hacía el código VIEJO (float), solo para demostrar que el test lo detecta

/** LO QUE HACÍA ANTES (no se usa en producción): `numCant * factor` en float y `Math.round(x * 10^d) / 10^d`. */
function conversionVieja(cantidad: number, factor: number, decimales: number): number {
  return redondearACantidadDeUnidad(cantidad * factor, decimales);
}
/** LO QUE HACÍA ANTES (no se usa en producción): división en float sin redondear (después la base redondeaba a 4 decimales). */
const precioViejo = (precioTotal: number, cantidad: number) => (precioTotal > 0 && cantidad > 0 ? precioTotal / cantidad : 0);

describe("convertirCantidadAUnidadDeStock — contra el oráculo BigInt", () => {
  it("propiedad: cantidad × factor redondeada a los decimales de la unidad = el oráculo, para cualquier cantidad, factor (hasta 4 decimales) y decimales 0 a 6", () => {
    fc.assert(
      fc.property(arbCantidad, arbFactor, arbDecimales, (cantidad, factor, decimales) => {
        const esperado = oraculoCantidadDeStock(cantidad, factor, decimales);
        const obtenido = convertirCantidadAUnidadDeStock(Number(cantidad), Number(factor), decimales).redondeada;
        expect(obtenido).toBe(esperado);
      }),
      RUNS
    );
  });

  it("propiedad: el resultado es siempre un valor en la grilla de la unidad (a lo sumo `decimales` decimales)", () => {
    fc.assert(
      fc.property(arbCantidad, arbFactor, arbDecimales, (cantidad, factor, decimales) => {
        const { redondeada } = convertirCantidadAUnidadDeStock(Number(cantidad), Number(factor), decimales);
        const texto = String(redondeada);
        expect(texto).not.toMatch(/e/i);
        expect((texto.split(".")[1] ?? "").length).toBeLessThanOrEqual(decimales);
      }),
      RUNS
    );
  });

  it("propiedad: la cantidad `exacta` (la del texto del detalle) es el producto exacto, sin ruido de float", () => {
    fc.assert(
      fc.property(arbCantidad, arbFactor, (cantidad, factor) => {
        const a = leer(cantidad);
        const b = leer(factor);
        const esperado = Number(aTexto({ n: a.n * b.n, escala: a.escala + b.escala }));
        expect(convertirCantidadAUnidadDeStock(Number(cantidad), Number(factor), 4).exacta).toBe(esperado);
      }),
      RUNS
    );
  });

  // Empates explícitos: cantidad × factor cae EXACTO en la mitad entre dos valores de la grilla. [cantidad, factor, decimales, esperado a mano]
  const EMPATES: [string, string, number, number][] = [
    ["1", "1.005", 2, 1.01],
    ["1", "0.125", 2, 0.13],
    ["1", "2.675", 2, 2.68],
    ["1", "0.285", 2, 0.29],
    ["1", "1.0005", 3, 1.001],
    ["1", "1.255", 2, 1.26],
    ["1", "10.075", 2, 10.08],
    ["7", "0.35", 1, 2.5],
    ["3", "0.835", 2, 2.51],
    ["1", "0.5", 0, 1],
    ["1", "2.5", 0, 3],
    ["3", "0.5", 0, 2],
    ["201", "0.005", 2, 1.01],
    ["1", "0.0000005", 6, 0.000001],
  ];

  it.each(EMPATES)("empate explícito: %s × %s a %i decimales = %s (el empate sube; coincide con el oráculo)", (cantidad, factor, decimales, esperado) => {
    expect(oraculoCantidadDeStock(cantidad, factor, decimales)).toBe(esperado); // el oráculo y la cuenta a mano coinciden
    expect(convertirCantidadAUnidadDeStock(Number(cantidad), Number(factor), decimales).redondeada).toBe(esperado);
  });

  it("sin ruido: 3 × 0,1 da exactamente 0,3 (en float da 0,30000000000000004) y 7 × 0,1 da 0,7", () => {
    expect(3 * 0.1).not.toBe(0.3); // referencia: el ruido existe en JS
    expect(convertirCantidadAUnidadDeStock(3, 0.1, 2)).toEqual({ exacta: 0.3, redondeada: 0.3 });
    expect(convertirCantidadAUnidadDeStock(7, 0.1, 2)).toEqual({ exacta: 0.7, redondeada: 0.7 });
  });

  it("empate con negativos: hacia +∞, como Math.round (0,125 → 0,13 pero −0,125 → −0,12) — regla heredada, no una decisión nueva", () => {
    expect(convertirCantidadAUnidadDeStock(1, 0.125, 2).redondeada).toBe(0.13);
    expect(convertirCantidadAUnidadDeStock(-1, 0.125, 2).redondeada).toBe(-0.12);
    expect(convertirCantidadAUnidadDeStock(-1, 2.5, 0).redondeada).toBe(-2);
  });

  it("propiedad (negativos): coincide con el oráculo también con cantidad negativa", () => {
    fc.assert(
      fc.property(arbCantidad, arbFactor, arbDecimales, (cantidad, factor, decimales) => {
        const esperado = oraculoCantidadDeStock("-" + cantidad, factor, decimales);
        const obtenido = convertirCantidadAUnidadDeStock(-Number(cantidad), Number(factor), decimales).redondeada;
        expect(obtenido + 0).toBe(esperado + 0); // `+ 0` normaliza -0 → 0
      }),
      RUNS
    );
  });
});

describe("convertirCantidadAUnidadDeStock — el código VIEJO (float) falla donde el nuevo no", () => {
  /** Empates donde el float redondeaba para el lado equivocado (verificado a mano: el valor correcto es el de la tabla de arriba). */
  const DONDE_EL_FLOAT_FALLA: [number, number, number, number][] = [
    [1, 1.005, 2, 1.01], // 1,005 × 100 = 100,49999999999999 → el float daba 1,00
    [1, 0.285, 2, 0.29], // 0,285 × 100 = 28,499999999999996 → 0,28
    [1, 1.255, 2, 1.26], // → 1,25
    [1, 10.075, 2, 10.08], // → 10,07
    [7, 0.35, 1, 2.5], // 7 × 0,35 = 2,4499999999999997 → 2,4
  ];

  it.each(DONDE_EL_FLOAT_FALLA)("%s × %s a %i decimales: el viejo daba otra cosa que %s; el nuevo da %s", (cantidad, factor, decimales, correcto) => {
    expect(conversionVieja(cantidad, factor, decimales)).not.toBe(correcto); // LO QUE HACÍA ANTES: mal
    expect(convertirCantidadAUnidadDeStock(cantidad, factor, decimales).redondeada).toBe(correcto);
    // y es el oráculo quien lo dice, no el código nuevo
    expect(oraculoCantidadDeStock(String(cantidad), String(factor), decimales)).toBe(correcto);
  });

  it("el test detecta lo que dice detectar: la propiedad contra el oráculo FALLA si se usa la fórmula vieja", () => {
    const aplicarPropiedad = (convertir: (c: number, f: number, d: number) => number) =>
      fc.assert(
        fc.property(arbCantidad, arbFactor, arbDecimales, (cantidad, factor, decimales) => {
          expect(convertir(Number(cantidad), Number(factor), decimales)).toBe(oraculoCantidadDeStock(cantidad, factor, decimales));
        }),
        RUNS
      );
    expect(() => aplicarPropiedad(conversionVieja)).toThrow();
    expect(() => aplicarPropiedad((c, f, d) => convertirCantidadAUnidadDeStock(c, f, d).redondeada)).not.toThrow();
  });
});

describe("precioPorUnidad — contra el oráculo BigInt", () => {
  it("propiedad: precio total ÷ cantidad a 4 decimales (empate alejándose del cero) = el oráculo", () => {
    fc.assert(
      fc.property(arbPrecioTotal, arbCantidad, (precioTotal, cantidad) => {
        expect(precioPorUnidad(Number(precioTotal), Number(cantidad))).toBe(oraculoPrecioPorUnidad(precioTotal, cantidad));
      }),
      RUNS
    );
  });

  it("propiedad: el precio por unidad también cuadra cuando la cantidad es la de stock ya convertida (precioTotal ÷ cantidadStock)", () => {
    fc.assert(
      fc.property(arbPrecioTotal, arbCantidad, arbFactor, arbDecimales, (precioTotal, cantidad, factor, decimales) => {
        const stock = convertirCantidadAUnidadDeStock(Number(cantidad), Number(factor), decimales).redondeada;
        if (stock <= 0) return;
        expect(precioPorUnidad(Number(precioTotal), stock)).toBe(oraculoPrecioPorUnidad(precioTotal, String(stock)));
      }),
      RUNS
    );
  });

  it("sin precio o sin cantidad: 0 (como antes)", () => {
    expect(precioPorUnidad(0, 5)).toBe(0);
    expect(precioPorUnidad(100, 0)).toBe(0);
    expect(precioPorUnidad(-1, 5)).toBe(0);
    expect(precioPorUnidad(100, -2)).toBe(0);
  });

  // [precioTotal, cantidad, esperado a mano]: los tres primeros son empates exactos del cuarto decimal; los otros dos, un resto que no es empate y una división exacta.
  const EMPATES_PRECIO: [string, string, number][] = [
    ["1.00", "32", 0.0313], // 0,03125 → 0,0313 (sube)
    ["1.00", "160", 0.0063], // 0,00625
    ["10.00", "64", 0.1563], // 0,15625
    ["0.01", "32", 0.0003], // 0,0003125: el resto está por debajo de la mitad
    ["1.00", "2.5", 0.4], // exacto
  ];
  it.each(EMPATES_PRECIO)("precio %s ÷ cantidad %s = %s", (precioTotal, cantidad, esperado) => {
    expect(oraculoPrecioPorUnidad(precioTotal, cantidad)).toBe(esperado);
    expect(precioPorUnidad(Number(precioTotal), Number(cantidad))).toBe(esperado);
  });

  it("el cociente en float sin redondear (lo de antes) no es un valor de 4 decimales; el nuevo sí lo es y es el que guardaba la base", () => {
    expect(precioViejo(100, 3)).toBe(33.333333333333336); // referencia: float crudo
    expect(precioPorUnidad(100, 3)).toBe(33.3333);
  });
});
