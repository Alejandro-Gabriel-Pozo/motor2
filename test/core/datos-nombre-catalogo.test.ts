import { describe, expect, it } from "vitest";
import { validarNombreCatalogo } from "@/core/datos/nombre-catalogo";

// Sin base de datos: validarNombreCatalogo es pura. Se apoya en validarTextoCatalogo (charset, 80 caracteres, sin "-" inicial).
describe("validarNombreCatalogo", () => {
  it("obligatorio vacío → error", () => {
    for (const v of ["", "   ", undefined, null]) {
      expect(validarNombreCatalogo(v, "El nombre", { obligatorio: true })).toEqual({ ok: false, codigo: "vacio", mensaje: "El nombre no puede estar vacío." });
    }
  });

  it("no obligatorio vacío → null", () => {
    expect(validarNombreCatalogo("  ", "El nombre", { obligatorio: false })).toEqual({ ok: true, valor: null });
  });

  it.each(["()", "...", "-", "/ &", "%"])("rechaza %j: sin ninguna letra ni número (hoy pasaba)", (nombre) => {
    const r = validarNombreCatalogo(nombre, "El nombre", { obligatorio: true });
    expect(r.ok).toBe(false);
  });

  it("'()' y '...' dan el mensaje de 'al menos una letra o un número'", () => {
    for (const nombre of ["()", "..."]) {
      expect(validarNombreCatalogo(nombre, "El nombre", { obligatorio: true })).toEqual({
        ok: false,
        codigo: "sin_alfanumerico",
        mensaje: "El nombre tiene que tener al menos una letra o un número.",
      });
    }
  });

  it.each(["Muzzarella", "Coca-Cola 500 cc", "Salsa (casera)", "Pan & Queso", "Jamón cocido 100% natural", "Harina 000/0000", "D'Oro"])(
    "los nombres válidos de texto-catalogo.test.ts siguen pasando: %s",
    (nombre) => {
      expect(validarNombreCatalogo(nombre, "El nombre", { obligatorio: true })).toEqual({ ok: true, valor: nombre });
    }
  );

  it("recorta los espacios", () => {
    expect(validarNombreCatalogo("  Harina  ", "El nombre", { obligatorio: true })).toEqual({ ok: true, valor: "Harina" });
  });

  it("reusa las reglas de validarTextoCatalogo (charset, largo, '-' inicial)", () => {
    expect(validarNombreCatalogo("a|b", "El nombre", { obligatorio: true })).toMatchObject({ ok: false, codigo: "caracteres" });
    expect(validarNombreCatalogo("-A1", "El nombre", { obligatorio: true })).toEqual({ ok: false, codigo: "caracteres", mensaje: 'El nombre no puede empezar con "-".' });
    expect(validarNombreCatalogo("a".repeat(81), "El nombre", { obligatorio: true })).toMatchObject({ ok: false, codigo: "largo" });
    expect(validarNombreCatalogo("a".repeat(80), "El nombre", { obligatorio: true })).toMatchObject({ ok: true });
  });
});
