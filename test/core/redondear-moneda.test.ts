import { describe, expect, it } from "vitest";
import { redondearMoneda } from "../../src/core/movimientos/transiciones";

/**
 * `redondearMoneda` tal como la usan los 19 importadores de `transiciones.ts` (plan de precisión de montos, 2026-09-25, Paso 2).
 * Antes era `Math.round(n * 100) / 100`: redondeaba para abajo los empates x,xx5 que no son exactos en binario, devolvía -0 y con
 * negativos desempataba hacia +∞. Ahora tiene que coincidir con `round(v::numeric, 2)` de Postgres.
 */
describe("redondearMoneda (desde transiciones.ts)", () => {
  it("empate x,xx5 no exacto en binario: 128,045 → 128,05 (el precio por lata de una factura de $1.024,36 por 8)", () => {
    expect(redondearMoneda(128.045)).toBe(128.05);
  });

  it("nunca devuelve -0 (saldo de consignación pagado con restos de float)", () => {
    expect(Object.is(redondearMoneda(0.3 - (0.1 + 0.2)), 0)).toBe(true);
  });

  it("negativos: el empate se aleja del cero, igual que NUMERIC (-128,045 → -128,05)", () => {
    expect(redondearMoneda(-128.045)).toBe(-128.05);
  });
});
