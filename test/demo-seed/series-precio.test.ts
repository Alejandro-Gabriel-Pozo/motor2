import { describe, expect, it } from "vitest";
import { crearGeneradorAleatorio } from "../../scripts/demo-seed/prng";
import { generarSerieDePrecio, precioEnSemana, type ConfigSerieDePrecio } from "../../scripts/demo-seed/series-precio";

const CONFIG_BASE: ConfigSerieDePrecio = {
  precioInicial: 1000,
  semanas: 26, // ~6 meses
  inflacionMensualEsperada: 0.04,
  dispersionSemanal: 0.015,
  probabilidadSaltoSemanal: 0.03,
  saltoMinPct: 0.08,
  saltoMaxPct: 0.2,
};

describe("generarSerieDePrecio", () => {
  it("la semana 0 es exactamente el precio inicial, sin ruido", () => {
    const serie = generarSerieDePrecio(CONFIG_BASE, crearGeneradorAleatorio(1));
    expect(serie[0]).toEqual({ semana: 0, precio: 1000, esSalto: false });
  });

  it("genera exactamente `semanas` puntos, con el índice de semana en orden", () => {
    const serie = generarSerieDePrecio(CONFIG_BASE, crearGeneradorAleatorio(1));
    expect(serie).toHaveLength(26);
    expect(serie.map((p) => p.semana)).toEqual(Array.from({ length: 26 }, (_, i) => i));
  });

  it("es determinística: la misma semilla da SIEMPRE la misma serie", () => {
    const serieA = generarSerieDePrecio(CONFIG_BASE, crearGeneradorAleatorio(99));
    const serieB = generarSerieDePrecio(CONFIG_BASE, crearGeneradorAleatorio(99));
    expect(serieA).toEqual(serieB);
  });

  it("sin dispersión ni saltos, sigue EXACTAMENTE el interés compuesto de la inflación mensual", () => {
    const config: ConfigSerieDePrecio = { ...CONFIG_BASE, dispersionSemanal: 0, probabilidadSaltoSemanal: 0, semanas: 10 };
    const serie = generarSerieDePrecio(config, crearGeneradorAleatorio(1));
    const factorSemanal = Math.pow(1.04, 1 / (52 / 12));
    for (let semana = 0; semana < 10; semana++) {
      const esperado = Math.round(1000 * factorSemanal ** semana * 100) / 100;
      expect(serie[semana]!.precio).toBeCloseTo(esperado, 2);
    }
  });

  it("con inflación 0 y sin ruido, el precio queda CONSTANTE — confirma que la tendencia y el ruido son piezas separadas", () => {
    const config: ConfigSerieDePrecio = { ...CONFIG_BASE, inflacionMensualEsperada: 0, dispersionSemanal: 0, probabilidadSaltoSemanal: 0, semanas: 15 };
    const serie = generarSerieDePrecio(config, crearGeneradorAleatorio(1));
    for (const punto of serie) expect(punto.precio).toBe(1000);
  });

  it("probabilidadSaltoSemanal=1 marca esSalto en TODAS las semanas después de la 0", () => {
    const config: ConfigSerieDePrecio = { ...CONFIG_BASE, probabilidadSaltoSemanal: 1, semanas: 8 };
    const serie = generarSerieDePrecio(config, crearGeneradorAleatorio(1));
    expect(serie[0]!.esSalto).toBe(false);
    for (const punto of serie.slice(1)) expect(punto.esSalto).toBe(true);
  });

  it("probabilidadSaltoSemanal=0 nunca marca esSalto", () => {
    const config: ConfigSerieDePrecio = { ...CONFIG_BASE, probabilidadSaltoSemanal: 0, semanas: 20 };
    const serie = generarSerieDePrecio(config, crearGeneradorAleatorio(1));
    expect(serie.every((p) => !p.esSalto)).toBe(true);
  });

  it("nunca cae por debajo del piso (30% del precio inicial), aunque la inflación sea negativa y el ruido grande", () => {
    const config: ConfigSerieDePrecio = { ...CONFIG_BASE, inflacionMensualEsperada: -0.5, dispersionSemanal: 0.5, semanas: 40 };
    const serie = generarSerieDePrecio(config, crearGeneradorAleatorio(2));
    for (const punto of serie) expect(punto.precio).toBeGreaterThanOrEqual(1000 * 0.3 - 0.01);
  });

  it("los saltos son siempre hacia arriba: con salto forzado, la semana con salto no puede terminar más barata que sin ruido de tendencia adicional", () => {
    // Sin dispersión, con salto forzado en TODAS las semanas: cada semana tiene que ser más cara que la tendencia sola.
    const config: ConfigSerieDePrecio = { ...CONFIG_BASE, dispersionSemanal: 0, probabilidadSaltoSemanal: 1, semanas: 6 };
    const serie = generarSerieDePrecio(config, crearGeneradorAleatorio(3));
    const factorSemanal = Math.pow(1.04, 1 / (52 / 12));
    for (let semana = 1; semana < 6; semana++) {
      const tendenciaSola = 1000 * factorSemanal ** semana;
      expect(serie[semana]!.precio).toBeGreaterThan(tendenciaSola);
    }
  });

  it("valida precioInicial > 0", () => {
    expect(() => generarSerieDePrecio({ ...CONFIG_BASE, precioInicial: 0 }, crearGeneradorAleatorio(1))).toThrow();
    expect(() => generarSerieDePrecio({ ...CONFIG_BASE, precioInicial: -5 }, crearGeneradorAleatorio(1))).toThrow();
  });

  it("valida semanas entero >= 1", () => {
    expect(() => generarSerieDePrecio({ ...CONFIG_BASE, semanas: 0 }, crearGeneradorAleatorio(1))).toThrow();
    expect(() => generarSerieDePrecio({ ...CONFIG_BASE, semanas: 2.5 }, crearGeneradorAleatorio(1))).toThrow();
  });

  it("valida saltoMaxPct >= saltoMinPct", () => {
    expect(() => generarSerieDePrecio({ ...CONFIG_BASE, saltoMinPct: 0.3, saltoMaxPct: 0.1 }, crearGeneradorAleatorio(1))).toThrow();
  });
});

describe("precioEnSemana", () => {
  const serie = generarSerieDePrecio(CONFIG_BASE, crearGeneradorAleatorio(1));

  it("da el precio exacto de una semana dentro de rango", () => {
    expect(precioEnSemana(serie, 5)).toBe(serie[5]!.precio);
  });

  it("una semana negativa da la primera (la serie no se extrapola hacia atrás)", () => {
    expect(precioEnSemana(serie, -3)).toBe(serie[0]!.precio);
  });

  it("una semana más allá del final da la última (la serie no se extrapola hacia adelante)", () => {
    expect(precioEnSemana(serie, 999)).toBe(serie[serie.length - 1]!.precio);
  });

  it("rechaza una serie vacía", () => {
    expect(() => precioEnSemana([], 0)).toThrow();
  });
});
