import { describe, expect, it } from "vitest";
import { resolverMinimosCuadrados } from "../../src/core/estadistica/minimos-cuadrados";

describe("resolverMinimosCuadrados", () => {
  it("recupera exactamente los coeficientes cuando los datos son consistentes sin ruido", () => {
    // y = 2*x1 + 3*x2, sin error — el caso "milanesa consume 2, bife consume 3".
    const X = [
      [10, 5],
      [4, 8],
      [6, 2],
      [1, 9],
    ];
    const y = X.map(([x1, x2]) => 2 * x1 + 3 * x2);

    const resultado = resolverMinimosCuadrados(X, y);
    expect(resultado).not.toBeNull();
    expect(resultado!.coeficientes[0]).toBeCloseTo(2, 6);
    expect(resultado!.coeficientes[1]).toBeCloseTo(3, 6);
    expect(resultado!.r2).toBeCloseTo(1, 6);
  });

  it("con ruido real, el ajuste da un R² alto pero no perfecto, y los coeficientes quedan cerca", () => {
    const X = [
      [10, 5],
      [4, 8],
      [6, 2],
      [1, 9],
      [8, 3],
      [2, 6],
    ];
    const ruido = [0.3, -0.2, 0.1, -0.4, 0.2, -0.1];
    const y = X.map(([x1, x2], i) => 2 * x1 + 3 * x2 + ruido[i]);

    const resultado = resolverMinimosCuadrados(X, y);
    expect(resultado).not.toBeNull();
    expect(resultado!.coeficientes[0]).toBeCloseTo(2, 1);
    expect(resultado!.coeficientes[1]).toBeCloseTo(3, 1);
    expect(resultado!.r2).toBeGreaterThan(0.9);
    expect(resultado!.r2).toBeLessThan(1);
  });

  it("da null si hay menos observaciones que incógnitas (sistema indeterminado)", () => {
    const X = [
      [10, 5],
      [4, 8],
    ];
    const y = [35, 32];
    // 2 observaciones, 2 incógnitas — filas <= columnas, no hay margen para estimar error.
    expect(resolverMinimosCuadrados(X, y)).toBeNull();
  });

  it("da null si dos platos siempre se vendieron en la misma proporción (columnas colineales)", () => {
    // x2 = 2*x1 siempre — no hay forma matemática de separar cuánto aportó cada uno.
    const X = [
      [10, 20],
      [4, 8],
      [6, 12],
      [1, 2],
    ];
    const y = [100, 40, 60, 10];
    expect(resolverMinimosCuadrados(X, y)).toBeNull();
  });

  it("da null con matrices vacías", () => {
    expect(resolverMinimosCuadrados([], [])).toBeNull();
  });
});
