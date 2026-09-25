import { describe, expect, it } from "vitest";
import { ordenSugeridoAlElegirSeccion } from "@/core/carta/orden-sugerido";

/**
 * Orden sugerido al elegir la sección de un producto o ítem agrupado (docs/plan-carta-seccion-directa-2026-09-25.md, DA6): lo usa
 * el componente cliente `SeccionYOrden`; el comportamiento en el navegador lo cubre test/e2e/carta-orden-sugerido.spec.ts.
 */
describe("ordenSugeridoAlElegirSeccion", () => {
  const cantidad = { sA: 3, sB: 0 };

  it("algo nuevo (sin nada guardado): la cantidad de ítems que ya tiene la sección elegida (queda al final)", () => {
    expect(ordenSugeridoAlElegirSeccion("sA", null, cantidad)).toBe(3);
    expect(ordenSugeridoAlElegirSeccion("sB", null, cantidad)).toBe(0);
    // Una sección que no está en el mapa (recién creada en otra pestaña): 0.
    expect(ordenSugeridoAlElegirSeccion("sNueva", null, cantidad)).toBe(0);
  });

  it("sin sección elegida (la opción vacía): no toca el campo", () => {
    expect(ordenSugeridoAlElegirSeccion("", null, cantidad)).toBeNull();
    expect(ordenSugeridoAlElegirSeccion("", { seccionCartaId: "sA", orden: 7 }, cantidad)).toBeNull();
  });

  it("editar: volver a la sección que ya tenía conserva el orden guardado; otra sección, el sugerido de esa", () => {
    const guardado = { seccionCartaId: "sA", orden: 7 };
    expect(ordenSugeridoAlElegirSeccion("sB", guardado, cantidad)).toBe(0);
    expect(ordenSugeridoAlElegirSeccion("sA", guardado, cantidad)).toBe(7);
  });

  it("un contenido guardado SIN sección (oculto): elegir una es como algo nuevo", () => {
    expect(ordenSugeridoAlElegirSeccion("sA", { seccionCartaId: null, orden: 5 }, cantidad)).toBe(3);
  });
});
