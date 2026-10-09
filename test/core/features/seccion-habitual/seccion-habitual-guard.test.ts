import { describe, expect, it } from "vitest";
import { guardComandoEliminarSeccionHabitual, guardComandoSeccionHabitual } from "../../../../src/core/features/seccion-habitual/seccion-habitual.guard";

/**
 * Guard de la feature «Sección habitual» (src/core/features/seccion-habitual/seccion-habitual.guard.ts): solo formato, puro. Hito 4, H4C-20: `guardSeccionHabitual`
 * pasó a llamarse `guardComandoSeccionHabitual` (mismos casos) y nació `guardComandoEliminarSeccionHabitual`.
 */
describe("guardComandoSeccionHabitual", () => {
  it("producto y sección elegidos: pasan, recortados", () => {
    expect(guardComandoSeccionHabitual({ productoId: " p1 ", seccionId: "s1" })).toEqual({ ok: true, valor: { productoId: "p1", seccionId: "s1" } });
  });

  it("sin producto: lo pide primero", () => {
    expect(guardComandoSeccionHabitual({ productoId: "", seccionId: "" })).toEqual({ ok: false, codigo: "vacio", mensaje: "Elegí un producto." });
    expect(guardComandoSeccionHabitual({ productoId: undefined, seccionId: "s1" })).toEqual({ ok: false, codigo: "vacio", mensaje: "Elegí un producto." });
  });

  it("sin sección (vacía, espacios o no string)", () => {
    for (const seccionId of ["", "   ", null, 42 as unknown]) {
      expect(guardComandoSeccionHabitual({ productoId: "p1", seccionId })).toMatchObject({ ok: false, codigo: "vacio", mensaje: "Elegí la sección habitual." });
    }
  });
});

describe("guardComandoEliminarSeccionHabitual", () => {
  it("un id de texto pasa TAL CUAL (sin recortar: se busca como llegó)", () => {
    expect(guardComandoEliminarSeccionHabitual({ id: " f1 " })).toEqual({ ok: true, valor: { id: " f1 " } });
  });

  it("un id que no es texto es «no encontrada» (sin leer la base)", () => {
    for (const id of [undefined, null, 42, {}]) {
      expect(guardComandoEliminarSeccionHabitual({ id })).toEqual({ ok: false, codigo: "formato", mensaje: "No se encontró esa sección habitual." });
    }
  });
});
