import { describe, expect, it } from "vitest";
import { guardSeccionHabitual } from "../../../../src/core/features/seccion-habitual/seccion-habitual.guard";

/** Guard de la feature «Sección habitual» (src/core/features/seccion-habitual/seccion-habitual.guard.ts): solo formato, puro. */
describe("guardSeccionHabitual", () => {
  it("producto y sección elegidos: pasan, recortados", () => {
    expect(guardSeccionHabitual({ productoId: " p1 ", seccionId: "s1" })).toEqual({ ok: true, valor: { productoId: "p1", seccionId: "s1" } });
  });

  it("sin producto: lo pide primero", () => {
    expect(guardSeccionHabitual({ productoId: "", seccionId: "" })).toEqual({ ok: false, codigo: "vacio", mensaje: "Elegí un producto." });
    expect(guardSeccionHabitual({ productoId: undefined, seccionId: "s1" })).toEqual({ ok: false, codigo: "vacio", mensaje: "Elegí un producto." });
  });

  it("sin sección (vacía, espacios o no string)", () => {
    for (const seccionId of ["", "   ", null, 42 as unknown]) {
      expect(guardSeccionHabitual({ productoId: "p1", seccionId })).toMatchObject({ ok: false, codigo: "vacio", mensaje: "Elegí la sección habitual." });
    }
  });
});
