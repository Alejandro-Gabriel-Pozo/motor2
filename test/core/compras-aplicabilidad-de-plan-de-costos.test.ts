import { describe, expect, it } from "vitest";
import { planDeCostosAplica } from "../../src/core/compras/aplicabilidad-de-plan-de-costos";

/**
 * M7, ADR-009 (familia «optin»): un plan de costos sin fila en la sucursal, o con `aplica = false`, NO aplica ahí. El embudo es el único lugar
 * que lo decide. Mutación demostrada: cambiar `=== true` por `!== false` hace que «sin fila» aplique y deja esta prueba en rojo.
 */
describe("planDeCostosAplica", () => {
  it("sin fila (null o undefined) el plan NO aplica", () => {
    expect(planDeCostosAplica(null)).toBe(false);
    expect(planDeCostosAplica(undefined)).toBe(false);
  });

  it("con `aplica: false` NO aplica, igual que sin fila", () => {
    expect(planDeCostosAplica({ aplica: false })).toBe(false);
    expect(planDeCostosAplica({ aplica: false })).toBe(planDeCostosAplica(undefined));
  });

  it("solo con `aplica: true` aplica", () => {
    expect(planDeCostosAplica({ aplica: true })).toBe(true);
  });
});
