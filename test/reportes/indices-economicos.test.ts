import { describe, expect, it } from "vitest";
import {
  antiguedadSerieIPC,
  DIAS_MAXIMOS_DE_ATRASO_IPC,
  esMesSinPublicar,
  resolverCoeficienteIPC,
  resolverVariacionPeriodoIPC,
  textoSerieIPCVencida,
  type SerieIPC,
} from "../../src/core/reportes/indices-economicos";

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

describe("antiguedadSerieIPC — cuán vieja es la serie (5c)", () => {
  /** Serie cuyo último mes publicado es `ultimoMes`; el resto de los datos no importa para la antigüedad. */
  const conUltimoMes = (ultimoMes: string | null): SerieIPC => ({ porMes: new Map(), ultimoValor: ultimoMes ? 100 : null, ultimoMes });
  const ahora = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it("el máximo previsto son 60 días", () => {
    expect(DIAS_MAXIMOS_DE_ATRASO_IPC).toBe(60);
  });

  it("sin ningún índice cargado: sin-datos, sin días", () => {
    expect(antiguedadSerieIPC(conUltimoMes(null), ahora("2026-09-20"))).toEqual({ estado: "sin-datos", ultimoMes: null, diasDeAtraso: null, maximo: 60 });
  });

  it("el rezago normal del INDEC es «al día»: el 12 de octubre el último mes publicado sigue siendo agosto (41 días desde su fin)", () => {
    expect(antiguedadSerieIPC(conUltimoMes("2026-08"), ahora("2026-10-12"))).toMatchObject({ estado: "al-dia", diasDeAtraso: 41 });
  });

  it("el último mes es el corriente (o uno futuro): 0 días, nunca negativo", () => {
    expect(antiguedadSerieIPC(conUltimoMes("2026-09"), ahora("2026-09-19"))).toMatchObject({ estado: "al-dia", diasDeAtraso: 0 });
    expect(antiguedadSerieIPC(conUltimoMes("2026-12"), ahora("2026-09-19"))).toMatchObject({ estado: "al-dia", diasDeAtraso: 0 });
  });

  it("borde exacto: 60 días es «al día» y 61 es «vencida»", () => {
    // El fin de agosto es el 1/9 a las 00:00 UTC: 60 días después es el 31/10.
    expect(antiguedadSerieIPC(conUltimoMes("2026-08"), ahora("2026-10-31"))).toMatchObject({ estado: "al-dia", diasDeAtraso: 60 });
    expect(antiguedadSerieIPC(conUltimoMes("2026-08"), ahora("2026-11-01"))).toMatchObject({ estado: "vencida", diasDeAtraso: 61 });
  });

  it("una serie parada hace 8 meses está vencida, con los días correctos", () => {
    expect(antiguedadSerieIPC(conUltimoMes("2026-01"), ahora("2026-09-20"))).toMatchObject({ estado: "vencida", ultimoMes: "2026-01", diasDeAtraso: 231 });
  });

  it("el cambio de año: el fin de diciembre es el 1 de enero del año siguiente", () => {
    expect(antiguedadSerieIPC(conUltimoMes("2025-12"), ahora("2026-03-02"))).toMatchObject({ estado: "al-dia", diasDeAtraso: 60 });
    expect(antiguedadSerieIPC(conUltimoMes("2025-12"), ahora("2026-03-03"))).toMatchObject({ estado: "vencida", diasDeAtraso: 61 });
  });

  it("el texto de la serie vencida dice desde cuándo, cuántos días y que no es el rezago del INDEC", () => {
    const texto = textoSerieIPCVencida(antiguedadSerieIPC(conUltimoMes("2026-01"), ahora("2026-09-20")));
    expect(texto).toContain("2026-01");
    expect(texto).toContain("231 días");
    expect(texto).toContain("60");
    expect(texto).toContain("falta sincronizar");
  });
});
