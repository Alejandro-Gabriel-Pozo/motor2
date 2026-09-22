import { describe, expect, it } from "vitest";
import { crearGeneradorAleatorio, entero, real, conProbabilidad, elegir, gaussiana } from "../../scripts/demo-seed/prng";

describe("crearGeneradorAleatorio", () => {
  it("la misma semilla da SIEMPRE la misma secuencia — reproducibilidad del guion", () => {
    const a = crearGeneradorAleatorio(42);
    const b = crearGeneradorAleatorio(42);
    const secA = Array.from({ length: 20 }, () => a());
    const secB = Array.from({ length: 20 }, () => b());
    expect(secA).toEqual(secB);
  });

  it("semillas distintas dan secuencias distintas", () => {
    const a = crearGeneradorAleatorio(1);
    const b = crearGeneradorAleatorio(2);
    const secA = Array.from({ length: 10 }, () => a());
    const secB = Array.from({ length: 10 }, () => b());
    expect(secA).not.toEqual(secB);
  });

  it("da siempre valores en [0, 1)", () => {
    const rand = crearGeneradorAleatorio(7);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("acepta semillas negativas o fuera de rango de 32 bits sin romperse", () => {
    expect(() => crearGeneradorAleatorio(-5)()).not.toThrow();
    expect(() => crearGeneradorAleatorio(99999999999)()).not.toThrow();
  });
});

describe("entero", () => {
  it("respeta el rango [min, max], inclusive de los dos extremos, en 1000 tiradas", () => {
    const rand = crearGeneradorAleatorio(1);
    const vistos = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = entero(rand, 3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
      vistos.add(v);
    }
    // Con 1000 tiradas sobre 5 valores posibles, tienen que aparecer los 5 — si solo aparecieran 1 o 2 habría un sesgo real.
    expect(vistos.size).toBe(5);
  });

  it("min === max da siempre ese único valor", () => {
    const rand = crearGeneradorAleatorio(1);
    expect(entero(rand, 4, 4)).toBe(4);
  });

  it("rechaza max < min", () => {
    const rand = crearGeneradorAleatorio(1);
    expect(() => entero(rand, 5, 3)).toThrow();
  });
});

describe("real", () => {
  it("respeta el rango [min, max)", () => {
    const rand = crearGeneradorAleatorio(2);
    for (let i = 0; i < 500; i++) {
      const v = real(rand, 10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });
});

describe("conProbabilidad", () => {
  it("p=0 nunca da true; p=1 siempre da true", () => {
    const rand = crearGeneradorAleatorio(3);
    for (let i = 0; i < 100; i++) {
      expect(conProbabilidad(rand, 0)).toBe(false);
      expect(conProbabilidad(rand, 1)).toBe(true);
    }
  });

  it("p=0.5 da aproximadamente mitad y mitad en 2000 tiradas (no exacto, pero lejos de 0 o de 2000)", () => {
    const rand = crearGeneradorAleatorio(4);
    let trues = 0;
    for (let i = 0; i < 2000; i++) if (conProbabilidad(rand, 0.5)) trues++;
    expect(trues).toBeGreaterThan(800);
    expect(trues).toBeLessThan(1200);
  });
});

describe("elegir", () => {
  it("elige siempre un elemento de las opciones dadas, y con suficientes tiradas aparecen todas", () => {
    const rand = crearGeneradorAleatorio(5);
    const opciones = ["a", "b", "c"] as const;
    const vistos = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const v = elegir(rand, opciones);
      expect(opciones).toContain(v);
      vistos.add(v);
    }
    expect(vistos.size).toBe(3);
  });

  it("rechaza un array vacío", () => {
    const rand = crearGeneradorAleatorio(5);
    expect(() => elegir(rand, [])).toThrow();
  });
});

describe("gaussiana", () => {
  it("da un promedio cercano a 0 y una dispersión razonable en 5000 tiradas", () => {
    const rand = crearGeneradorAleatorio(6);
    const muestras = Array.from({ length: 5000 }, () => gaussiana(rand));
    const promedio = muestras.reduce((a, b) => a + b, 0) / muestras.length;
    expect(Math.abs(promedio)).toBeLessThan(0.1); // media teórica 0
    const desvio = Math.sqrt(muestras.reduce((a, b) => a + (b - promedio) ** 2, 0) / muestras.length);
    expect(desvio).toBeGreaterThan(0.85); // desvío teórico 1
    expect(desvio).toBeLessThan(1.15);
  });
});
