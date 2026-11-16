import { CLASES_DE_MOVIMIENTO, DENOMINACIONES_DE_BILLETE, MAXIMO_DE_RENGLONES_DE_COBRO, TOPE_EN_CENTAVOS, centavosDeImporte, diferenciaDeArqueo, importeDeCentavos, importeValidoParaClase, repartirCobro, signoDeClase, totalContadoEnCentavos } from "@/core/caja/public";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const c = (n: number) => BigInt(n);

describe("dinero de caja", () => {
  it("pasa a centavos sin error de coma flotante", () => {
    expect(centavosDeImporte(0.29)).toBe(c(29));
    expect(centavosDeImporte(1234.55)).toBe(c(123455));
    expect(centavosDeImporte(128.05)).toBe(c(12805));
  });
  it("rechaza lo que no entra en Decimal(14,2)", () => {
    expect(centavosDeImporte(0.001)).toBeNull();
    expect(centavosDeImporte(1e12)).toBeNull();
    expect(centavosDeImporte(Number.NaN)).toBeNull();
    expect(centavosDeImporte(Number.POSITIVE_INFINITY)).toBeNull();
  });
  it("ida y vuelta exacta para cualquier importe de la columna", () => {
    fc.assert(fc.property(fc.integer({ min: -99_999_999_999_999, max: 99_999_999_999_999 }), (centavos) => {
      expect(centavosDeImporte(importeDeCentavos(c(centavos)))).toBe(c(centavos));
    }));
  });
});

describe("reparto de un cobro (I-4: Σ renglones = total al centavo)", () => {
  const r = (medioDePagoId: string, n: number) => ({ medioDePagoId, importeEnCentavos: c(n) });
  it("acepta cuando la suma da el total, en orden canónico", () => {
    const x = repartirCobro([r("b", 300), r("a", 700)], c(1000));
    expect(x.ok).toBe(true);
    if (x.ok) expect(x.valor.map((v) => v.medioDePagoId)).toEqual(["a", "b"]);
  });
  it("el mismo pedido en otro orden da el mismo resultado", () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.constantFrom("a", "b", "c"), fc.integer({ min: 1, max: 100000 })), { minLength: 1, maxLength: 8 }), (pares) => {
      const rens = pares.map(([m, n]) => r(m, n));
      const total = rens.reduce((s, v) => s + v.importeEnCentavos, c(0));
      const x = repartirCobro(rens, total);
      const y = repartirCobro([...rens].reverse(), total);
      expect(x).toEqual(y);
    }));
  });
  it("falta y sobra se informan en centavos", () => {
    expect(repartirCobro([r("a", 900)], c(1000))).toEqual({ ok: false, error: "COBRO_NO_CUADRA", diferencia: { falta: c(100), sobra: c(0) } });
    expect(repartirCobro([r("a", 1100)], c(1000))).toEqual({ ok: false, error: "COBRO_NO_CUADRA", diferencia: { falta: c(0), sobra: c(100) } });
  });
  it("rechaza vacío, importes no positivos, sin medio y demasiados renglones", () => {
    expect(repartirCobro([], c(1))).toEqual({ ok: false, error: "COBRO_SIN_RENGLONES" });
    expect(repartirCobro([r("a", 0)], c(0))).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    expect(repartirCobro([r("a", -5), r("b", 15)], c(10))).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    expect(repartirCobro([r("", 5)], c(5))).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    expect(repartirCobro([{ medioDePagoId: "a", importeEnCentavos: TOPE_EN_CENTAVOS }], TOPE_EN_CENTAVOS)).toEqual({ ok: false, error: "IMPORTE_INVALIDO" });
    expect(repartirCobro(Array.from({ length: MAXIMO_DE_RENGLONES_DE_COBRO + 1 }, () => r("a", 1)), c(51))).toEqual({ ok: false, error: "COBRO_CON_DEMASIADOS_RENGLONES" });
  });
});

describe("arqueo", () => {
  it("suma billetes por denominación y monedas", () => {
    const x = totalContadoEnCentavos({ billetes: { 20000: 1, 500: 3 }, monedasEnCentavos: c(250) });
    expect(x).toEqual({ ok: true, centavos: c(20000 * 100 + 1500 * 100 + 250) });
  });
  it("rechaza denominaciones y cantidades fuera de la lista permitida", () => {
    expect(totalContadoEnCentavos({ billetes: { 50: 1 } as never, monedasEnCentavos: c(0) })).toEqual({ ok: false, error: "DENOMINACION_DESCONOCIDA" });
    expect(totalContadoEnCentavos({ billetes: { 100: -1 }, monedasEnCentavos: c(0) })).toEqual({ ok: false, error: "CANTIDAD_DE_BILLETES_INVALIDA" });
    expect(totalContadoEnCentavos({ billetes: { 100: 1.5 }, monedasEnCentavos: c(0) })).toEqual({ ok: false, error: "CANTIDAD_DE_BILLETES_INVALIDA" });
    expect(totalContadoEnCentavos({ billetes: {}, monedasEnCentavos: c(-1) })).toEqual({ ok: false, error: "MONEDAS_INVALIDAS" });
  });
  it("la diferencia es contado − esperado", () => {
    expect(diferenciaDeArqueo(c(900), c(1000))).toBe(c(-100));
    expect(DENOMINACIONES_DE_BILLETE).toHaveLength(7);
  });
});

describe("movimientos: signo por clase (oráculo escrito aparte del código)", () => {
  const ORACULO: Record<(typeof CLASES_DE_MOVIMIENTO)[number], { positivo: boolean; cero: boolean; negativo: boolean }> = {
    FONDO_INICIAL: { positivo: true, cero: true, negativo: false },
    COBRO: { positivo: true, cero: false, negativo: false },
    INGRESO_MANUAL: { positivo: true, cero: false, negativo: false },
    EGRESO_MANUAL: { positivo: false, cero: false, negativo: true },
    AJUSTE: { positivo: true, cero: false, negativo: true },
    ANULACION: { positivo: true, cero: false, negativo: true },
  };
  it("todas las clases × signo coinciden con el oráculo", () => {
    for (const clase of CLASES_DE_MOVIMIENTO) {
      expect(importeValidoParaClase(clase, c(5))).toBe(ORACULO[clase].positivo);
      expect(importeValidoParaClase(clase, c(0))).toBe(ORACULO[clase].cero);
      expect(importeValidoParaClase(clase, c(-5))).toBe(ORACULO[clase].negativo);
    }
    expect(signoDeClase("EGRESO_MANUAL")).toBe(-1);
  });
});
