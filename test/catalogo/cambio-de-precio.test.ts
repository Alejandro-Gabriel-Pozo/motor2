import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { UMBRAL_DE_CAMBIO_DE_PRECIO, cambioDePrecio } from "../../src/core/catalogo/cambio-de-precio";

/**
 * La regla que decide cuándo la pantalla del precio por sucursal pide una confirmación aparte (decisión del dueño: «antes → después» siempre y confirmación extra si el precio cambia MÁS de 30 %).
 * Se compara en centavos enteros: el borde exacto (30 %) NO confirma, y un centavo más sí.
 */
describe("cambioDePrecio: cuándo pide confirmar", () => {
  it.each([
    [10000, 13000, false, "justo 30 % de aumento: no es «más de 30 %»"],
    [10000, 13001, true, "30,01 %: sí"],
    [10000, 7000, false, "justo 30 % de baja: no"],
    [10000, 6999, true, "30,01 % de baja: sí"],
    [10000, 10000, false, "sin cambio"],
    [10000, 20000, true, "se duplica"],
    [10000, 0, true, "a cero: baja 100 %"],
    [18000, 22000, false, "+22,2 %: no confirma"],
    [0.1, 0.13, false, "centavos chicos: 0,10 a 0,13 es justo 30 %"],
    [0.1, 0.14, true, "0,10 a 0,14 es 40 %"],
  ])("de %s a %s → pideConfirmar=%s (%s)", (antes, despues, pide) => {
    expect(cambioDePrecio(antes, despues).pideConfirmar).toBe(pide);
  });

  it("sin precio de partida (cero) no hay porcentaje ni confirmación, aunque el precio nuevo sea alto", () => {
    const c = cambioDePrecio(0, 50000);
    expect(c.porcentaje).toBeNull();
    expect(c.pideConfirmar).toBe(false);
    expect(c.diferencia).toBe(50000);
  });

  it("devuelve el antes, el después, la diferencia con signo y el porcentaje sobre el antes", () => {
    const c = cambioDePrecio(18000, 22000);
    expect(c).toMatchObject({ antes: 18000, despues: 22000, diferencia: 4000 });
    expect(c.porcentaje).toBeCloseTo(22.222, 2);
    expect(cambioDePrecio(20000, 15000).porcentaje).toBeCloseTo(-25, 6);
  });

  it("el umbral es 30 %", () => {
    expect(UMBRAL_DE_CAMBIO_DE_PRECIO).toBe(0.3);
  });
});

describe("cambioDePrecio: propiedades", () => {
  const centavos = fc.integer({ min: 1, max: 100_000_000 });

  it("pide confirmar si y solo si |después − antes| > 30 % del antes (en centavos enteros)", () => {
    fc.assert(
      fc.property(centavos, centavos, (a, d) => {
        const esperado = Math.abs(d - a) * 10 > a * 3;
        expect(cambioDePrecio(a / 100, d / 100).pideConfirmar).toBe(esperado);
      }),
    );
  });

  it("subir y bajar el mismo monto desde el mismo antes tiene la misma diferencia absoluta, y un precio igual nunca confirma", () => {
    fc.assert(
      fc.property(centavos, (a) => {
        expect(cambioDePrecio(a / 100, a / 100).pideConfirmar).toBe(false);
        expect(cambioDePrecio(a / 100, a / 100).diferencia).toBe(0);
      }),
    );
  });
});
