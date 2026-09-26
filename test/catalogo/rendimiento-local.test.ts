import { describe, expect, it } from "vitest";
import { rendimientoEfectivo } from "../../src/core/catalogo/rendimiento-local";

describe("rendimientoEfectivo (D2, docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md)", () => {
  const central = { cantidad: 1, mermaPorcentaje: 12.5 };

  it("sin overrides: devuelve LOS MISMOS números que el central (Object.is), calibrado=false", () => {
    const r = rendimientoEfectivo(central, undefined, "sucursal-A");
    expect(Object.is(r.cantidad, central.cantidad)).toBe(true);
    expect(Object.is(r.mermaPorcentaje, central.mermaPorcentaje)).toBe(true);
    expect(r.calibrado).toBe(false);
  });

  it("con overrides de OTRA sucursal (lista no vacía, pero ninguno coincide): igual que sin overrides", () => {
    const r = rendimientoEfectivo(central, [{ sucursalId: "sucursal-B", cantidad: 5, mermaPorcentaje: 0 }], "sucursal-A");
    expect(Object.is(r.cantidad, central.cantidad)).toBe(true);
    expect(Object.is(r.mermaPorcentaje, central.mermaPorcentaje)).toBe(true);
    expect(r.calibrado).toBe(false);
  });

  it("override PARCIAL: solo merma calibrada — cantidad sigue siendo la central (Object.is), merma es la override, calibrado=true", () => {
    const r = rendimientoEfectivo(central, [{ sucursalId: "sucursal-A", cantidad: null, mermaPorcentaje: 20 }], "sucursal-A");
    expect(Object.is(r.cantidad, central.cantidad)).toBe(true);
    expect(r.mermaPorcentaje).toBe(20);
    expect(r.calibrado).toBe(true);
  });

  it("override PARCIAL: solo cantidad calibrada — merma sigue siendo la central (Object.is), cantidad es la override, calibrado=true", () => {
    const r = rendimientoEfectivo(central, [{ sucursalId: "sucursal-A", cantidad: 2.5, mermaPorcentaje: null }], "sucursal-A");
    expect(r.cantidad).toBe(2.5);
    expect(Object.is(r.mermaPorcentaje, central.mermaPorcentaje)).toBe(true);
    expect(r.calibrado).toBe(true);
  });

  it("override COMPLETO: los dos campos calibrados, calibrado=true", () => {
    const r = rendimientoEfectivo(central, [{ sucursalId: "sucursal-A", cantidad: 3, mermaPorcentaje: 33.33 }], "sucursal-A");
    expect(r).toEqual({ cantidad: 3, mermaPorcentaje: 33.33, calibrado: true });
  });

  it("filtra por sucursalId ADENTRO (defensa en profundidad): con overrides de varias sucursales, usa el que coincide, ignora los demás", () => {
    const overrides = [
      { sucursalId: "sucursal-X", cantidad: 999, mermaPorcentaje: 999 },
      { sucursalId: "sucursal-A", cantidad: 1.8, mermaPorcentaje: null },
      { sucursalId: "sucursal-Z", cantidad: 111, mermaPorcentaje: 111 },
    ];
    const r = rendimientoEfectivo(central, overrides, "sucursal-A");
    expect(r.cantidad).toBe(1.8);
    expect(Object.is(r.mermaPorcentaje, central.mermaPorcentaje)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Prueba por propiedades: 10.000 pares pseudoaleatorios (LCG con semilla fija, reproducible sin dependencias externas) —
  // SIN override, `rendimientoEfectivo` tiene que dar EXACTAMENTE lo mismo (Object.is) que la fórmula vieja (leer central.*
  // directo), para cualquier par (cantidad, mermaPorcentaje) que el schema admita. Es el criterio 2 de "el valor central da
  // lo mismo que hoy" (paso 11 del plan).
  // ---------------------------------------------------------------------------
  it("prueba por propiedades: sin override, Object.is con la fórmula vieja para 10.000 pares pseudoaleatorios", () => {
    let semilla = 0x2a2a2a2a; // fija, reproducible
    function siguiente(): number {
      // LCG (parámetros de Numerical Recipes) — determinístico, sin dependencias externas.
      semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0;
      return semilla / 4294967296;
    }

    for (let i = 0; i < 10_000; i++) {
      // Rangos realistas del schema: cantidad Decimal(14,4) > 0, mermaPorcentaje Decimal(6,2) 0-9999,99.
      const cantidad = siguiente() * 10_000;
      const mermaPorcentaje = siguiente() * 9999.99;
      const centralAleatorio = { cantidad, mermaPorcentaje };

      const viejo = { cantidad: centralAleatorio.cantidad, mermaPorcentaje: centralAleatorio.mermaPorcentaje };
      const nuevo = rendimientoEfectivo(centralAleatorio, undefined, "cualquier-sucursal");

      expect(Object.is(nuevo.cantidad, viejo.cantidad), `iteración ${i}: cantidad=${cantidad}`).toBe(true);
      expect(Object.is(nuevo.mermaPorcentaje, viejo.mermaPorcentaje), `iteración ${i}: merma=${mermaPorcentaje}`).toBe(true);
      expect(nuevo.calibrado).toBe(false);
    }
  });
});
