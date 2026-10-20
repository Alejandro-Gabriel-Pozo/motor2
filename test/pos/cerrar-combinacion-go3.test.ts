import { describe, expect, it } from "vitest";
import { lineasDeVenta } from "../../src/core/pos/cuenta";

/**
 * GO-3b (ADR-032, frente B, F5 paso I3): `lineasDeVenta` separa la línea por la versión de la receta propia de una combinación (y un espejo la hereda de su original), sin tocar lo que no la tiene.
 *
 * Fase 3 de la ola «precio y carta», paso 3.3: la venta ya no escribe la foto de la combinación (`CombinacionEnLinea`), así que los casos contra Postgres de este archivo (cerrar con la receta propia
 * congelada) se retiraron; los dos comportamientos de los COMBOS que solo se probaban acá viven sin receta propia en `cerrar-combo-configurado-go3.test.ts` (paso 3.0b). Este caso puro se va en el
 * paso 3.4, junto con la clave `|r:` de `lineasDeVenta`.
 */
describe("cerrar una línea con receta propia de la combinación (GO-3b, I3)", () => {
  it("lineasDeVenta: la versión de la receta separa la línea y un espejo la hereda; sin ella, igual que siempre", () => {
    const base = { productoId: "cafe", precioUnitario: 1100, huellaOpciones: "a".repeat(64) };
    const items = [
      { ...base, id: "a", cantidad: 1, recetaDeCombinacion: "r1" },
      { ...base, id: "b", cantidad: 1, recetaDeCombinacion: "r2" },
      { ...base, id: "c", cantidad: -1, anulaAItemId: "a" },
    ];
    // El espejo de «a» hereda su versión (r1): esa línea queda en 0 y no se vende; «b» (r2) es otra línea.
    expect(lineasDeVenta(items).map((l) => [l.cantidad, l.itemIds])).toEqual([[1, ["b"]]]);
    // Con las dos versiones iguales (o sin receta), una sola línea de ×2, como siempre.
    expect(lineasDeVenta([{ ...base, id: "a", cantidad: 1, recetaDeCombinacion: "r1" }, { ...base, id: "b", cantidad: 1, recetaDeCombinacion: "r1" }]).map((l) => l.cantidad)).toEqual([2]);
    expect(lineasDeVenta([{ ...base, id: "a", cantidad: 1 }, { ...base, id: "b", cantidad: 1 }]).map((l) => l.cantidad)).toEqual([2]);
  });
});
