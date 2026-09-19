import { describe, expect, it } from "vitest";
import { esMesSinPublicar, resolverCoeficienteIPC, resolverVariacionPeriodoIPC, type SerieIPC } from "../../src/core/reportes/indices-economicos";

/**
 * El INDEC publica el IPC de un mes a mitad del mes siguiente. Hasta entonces el mes en curso no tiene índice: las ventas de ese
 * mes NO quedan afuera del ajuste, se tratan como hechas en el último mes publicado (provisorio) y se corrigen solas cuando
 * se publique el mes (el reporte se recalcula en cada lectura).
 */
const serie: SerieIPC = {
  porMes: new Map([
    ["2026-06", 100],
    ["2026-07", 110],
    ["2026-08", 121],
  ]),
  ultimoValor: 121,
  ultimoMes: "2026-08",
};
const d = (iso: string) => new Date(iso);

describe("resolverCoeficienteIPC", () => {
  it("un mes publicado se lleva al último publicado", () => {
    expect(resolverCoeficienteIPC(d("2026-07-15"), serie)).toBeCloseTo(121 / 110, 10);
    expect(resolverCoeficienteIPC(d("2026-06-01"), serie)).toBeCloseTo(1.21, 10);
    expect(resolverCoeficienteIPC(d("2026-08-20"), serie)).toBe(1);
  });

  it("un mes posterior al último publicado no queda afuera: coeficiente 1, provisorio", () => {
    expect(resolverCoeficienteIPC(d("2026-09-19"), serie)).toBe(1);
    expect(resolverCoeficienteIPC(d("2026-10-02"), serie)).toBe(1);
    expect(esMesSinPublicar(d("2026-09-19"), serie)).toBe(true);
    expect(esMesSinPublicar(d("2026-08-31"), serie)).toBe(false);
  });

  it("cuando el INDEC publica el mes, el mismo cálculo se corrige solo", () => {
    const conSeptiembre: SerieIPC = { porMes: new Map([...serie.porMes, ["2026-09", 124.2]]), ultimoValor: 124.2, ultimoMes: "2026-09" };
    expect(resolverCoeficienteIPC(d("2026-09-19"), conSeptiembre)).toBe(1); // ahora es el último publicado
    expect(resolverCoeficienteIPC(d("2026-08-20"), conSeptiembre)).toBeCloseTo(124.2 / 121, 10); // y agosto pasa a ajustarse
    expect(esMesSinPublicar(d("2026-09-19"), conSeptiembre)).toBe(false);
  });

  it("un hueco real en la serie (mes anterior al último que falta) sigue dando null: no se inventa un valor intermedio", () => {
    const conHueco: SerieIPC = { porMes: new Map([["2026-06", 100], ["2026-08", 121]]), ultimoValor: 121, ultimoMes: "2026-08" };
    expect(resolverCoeficienteIPC(d("2026-07-10"), conHueco)).toBeNull();
  });

  it("sin ningún índice cargado da null", () => {
    expect(resolverCoeficienteIPC(d("2026-09-19"), { porMes: new Map(), ultimoValor: null, ultimoMes: null })).toBeNull();
    expect(esMesSinPublicar(d("2026-09-19"), { porMes: new Map(), ultimoValor: null, ultimoMes: null })).toBe(false);
  });
});

describe("resolverVariacionPeriodoIPC", () => {
  it("entre dos meses publicados", () => {
    expect(resolverVariacionPeriodoIPC(d("2026-06-01"), d("2026-08-31"), serie)).toBe(21);
  });

  it("un mes final sin publicar mide hasta el último publicado (provisorio)", () => {
    expect(resolverVariacionPeriodoIPC(d("2026-06-01"), d("2026-09-19"), serie)).toBe(21);
  });

  it("si el período entero está en meses sin publicar (el mes en curso, la vista por defecto), es «sin dato», no 0 %", () => {
    expect(resolverVariacionPeriodoIPC(d("2026-09-01"), d("2026-09-19"), serie)).toBeNull();
  });

  it("sin dato en un mes anterior al último da null", () => {
    expect(resolverVariacionPeriodoIPC(d("2026-01-01"), d("2026-08-31"), serie)).toBeNull();
  });
});
