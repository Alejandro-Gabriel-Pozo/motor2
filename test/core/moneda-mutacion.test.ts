import { describe, expect, it } from "vitest";
import { cocienteRedondeadoArriba, importeDeLinea, totalDeLineas } from "../../src/core/moneda";

/**
 * Tests puros de src/core/moneda.ts que cierran los mutantes SOBREVIVIENTES del piloto de Stryker (`npm run mutacion:piloto`, config
 * `stryker.piloto.config.mjs`): comportamientos de dinero que ningún test fijaba (`cocienteRedondeadoArriba` entero, la precisión de
 * 40 dígitos y la guarda de datos no finitos de `totalDeLineas`). Los valores son concretos, calculados a mano o contra el producto
 * exacto en decimal, nunca con float.
 */
describe("moneda — cocienteRedondeadoArriba (redondeo HACIA ARRIBA a centavos)", () => {
  it("nunca baja de lo que da la cuenta: cualquier resto, por chico que sea, sube el centavo", () => {
    expect(cocienteRedondeadoArriba(1, 3)).toBe(0.34);
    expect(cocienteRedondeadoArriba(2, 3)).toBe(0.67);
    expect(cocienteRedondeadoArriba(10, 3)).toBe(3.34);
    expect(cocienteRedondeadoArriba(1.001, 1)).toBe(1.01);
    expect(cocienteRedondeadoArriba(4.001, 1)).toBe(4.01);
  });

  it("lo que ya cae justo en centavos no sube (12,5 no pasa a 12,51; 4,01 queda 4,01)", () => {
    expect(cocienteRedondeadoArriba(1250, 100)).toBe(12.5);
    expect(cocienteRedondeadoArriba(7, 2)).toBe(3.5);
    expect(cocienteRedondeadoArriba(4.01, 1)).toBe(4.01);
    expect(cocienteRedondeadoArriba(10, 4)).toBe(2.5);
    expect(cocienteRedondeadoArriba(100, 1)).toBe(100);
  });

  it("el factor multiplica el numerador antes de dividir (en decimal exacto)", () => {
    expect(cocienteRedondeadoArriba(10, 3, 2)).toBe(6.67);
    expect(cocienteRedondeadoArriba(10, 3, 3)).toBe(10);
    expect(cocienteRedondeadoArriba(1, 3, 3)).toBe(1);
    expect(cocienteRedondeadoArriba(5, 4, 0)).toBe(0);
    // sin factor, el factor es 1
    expect(cocienteRedondeadoArriba(10, 4)).toBe(cocienteRedondeadoArriba(10, 4, 1));
  });

  it("el ruido de coma flotante no empuja un centavo de más (se descarta a 6 decimales)", () => {
    expect(cocienteRedondeadoArriba(4.000000000000001, 1)).toBe(4);
    expect(cocienteRedondeadoArriba(0.1 + 0.2, 0.1)).toBe(3);
    // el borde: menos de media millonésima se descarta, media millonésima o más cuenta como resto real
    expect(cocienteRedondeadoArriba(4.0000004, 1)).toBe(4);
    expect(cocienteRedondeadoArriba(4.0000005, 1)).toBe(4.01);
    expect(cocienteRedondeadoArriba(4.000001, 1)).toBe(4.01);
  });

  it("negativos: sube hacia +∞ (nunca se aleja del cero) y nunca devuelve -0", () => {
    expect(cocienteRedondeadoArriba(-1, 3)).toBe(-0.33);
    expect(cocienteRedondeadoArriba(-4.001, 1)).toBe(-4);
    expect(Object.is(cocienteRedondeadoArriba(-0.001, 1), 0)).toBe(true);
    expect(Object.is(cocienteRedondeadoArriba(-1, 1000), 0)).toBe(true);
    expect(Object.is(cocienteRedondeadoArriba(0, 5), 0)).toBe(true);
    expect(Object.is(cocienteRedondeadoArriba(-0, 5), 0)).toBe(true);
  });

  it("denominador 0 o negativo da NaN (quien llama lo valida; acá no se divide por cero ni se invierte el signo)", () => {
    expect(cocienteRedondeadoArriba(1, 0)).toBeNaN();
    expect(cocienteRedondeadoArriba(0, 0)).toBeNaN();
    expect(cocienteRedondeadoArriba(1, -1)).toBeNaN();
    expect(cocienteRedondeadoArriba(-1, -3)).toBeNaN();
    // un denominador positivo, por chico que sea, es válido
    expect(cocienteRedondeadoArriba(1, 0.5)).toBe(2);
    expect(cocienteRedondeadoArriba(1, 0.001)).toBe(1000);
  });

  it("cualquier dato no finito da NaN, argumento por argumento (con ±Infinity, que sin la guarda daría ±Infinity o 0)", () => {
    for (const noFinito of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(cocienteRedondeadoArriba(noFinito, 3), `numerador ${noFinito}`).toBeNaN();
      expect(cocienteRedondeadoArriba(10, noFinito), `denominador ${noFinito}`).toBeNaN();
      expect(cocienteRedondeadoArriba(10, 3, noFinito), `factor ${noFinito}`).toBeNaN();
    }
  });
});

describe("moneda — precisión de 40 dígitos del Decimal propio (no los 20 por defecto de decimal.js)", () => {
  // El producto exacto de estos dos números (cada uno con 14 a 16 dígitos significativos) es 2837767060369.45499999281359222: un
  // centavo por DEBAJO del empate. Con 20 dígitos de precisión el producto se redondea a 2837767060369.4550000 ANTES de pasar a
  // centavos y el empate sube a 2837767060369,46 (un centavo de más). Con 40 dígitos queda 2837767060369,45.
  const cantidad = 536862.94532467;
  const precioUnitario = 5285831.486569266;

  it("importeDeLinea: el producto de dos números largos se redondea una sola vez, sobre el valor exacto", () => {
    expect(importeDeLinea(cantidad, precioUnitario)).toBe(2837767060369.45);
    expect(importeDeLinea(precioUnitario, cantidad)).toBe(2837767060369.45);
  });

  it("totalDeLineas: lo mismo en la suma exacta de productos", () => {
    expect(totalDeLineas([{ cantidad, precioUnitario }])).toBe(2837767060369.45);
  });

  it("otro caso, en el borde de abajo (exacto 4716801858911.2249999810942850838 → ,22 y no ,23)", () => {
    expect(importeDeLinea(556564.7783578287, 8474847.928444874)).toBe(4716801858911.22);
  });
});

describe("moneda — totalDeLineas con datos no finitos pasa igual que en float, no en decimal", () => {
  // `1e300 × -1e300` desborda a -Infinity en float, pero en decimal es un número finito enorme: sin la guarda, `Infinity + (-1e600)`
  // daría Infinity en vez del NaN que da la suma en float (`Infinity + -Infinity`). La guarda existe para que un dato no finito
  // se comporte igual que antes del Decimal («NaN e ±Infinity pasan igual que hoy»).
  it("una línea no finita y otra que desborda el float dan NaN, en cualquier orden", () => {
    const noFinita = { cantidad: Number.POSITIVE_INFINITY, precioUnitario: 1 };
    const desborda = { cantidad: 1e300, precioUnitario: -1e300 };
    expect(totalDeLineas([noFinita, desborda])).toBeNaN();
    expect(totalDeLineas([desborda, noFinita])).toBeNaN();
    expect(totalDeLineas([{ cantidad: 1, precioUnitario: Number.POSITIVE_INFINITY }, desborda])).toBeNaN();
  });

  it("la misma lista sin la línea no finita sí se calcula en decimal exacto (finito, sin guarda)", () => {
    expect(totalDeLineas([{ cantidad: 2, precioUnitario: 1.5 }, { cantidad: 3, precioUnitario: 0.1 }])).toBe(3.3);
  });
});
