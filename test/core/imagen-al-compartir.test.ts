import { describe, expect, it } from "vitest";
import { imagenAlCompartirDeSucursal } from "../../src/core/carta/metadatos";

/** Dueño, 2026-11-17: «Como pedernal» → la vista previa usa el LOGO; la imagen de fondo de la portada ya no es la primera opción. */
const LOGO = "https://cdn.ejemplo.test/logo.png";
const FONDO = "https://cdn.ejemplo.test/fondo.jpg";

describe("imagenAlCompartirDeSucursal", () => {
  it("con logo y con imagen de fondo: el logo", () => {
    expect(imagenAlCompartirDeSucursal({ restaurante_logo_url: LOGO, hero_imagen_fondo_url: FONDO })).toBe(LOGO);
  });
  it("con logo y sin imagen de fondo: el logo", () => {
    expect(imagenAlCompartirDeSucursal({ restaurante_logo_url: LOGO })).toBe(LOGO);
    expect(imagenAlCompartirDeSucursal({ restaurante_logo_url: LOGO, hero_imagen_fondo_url: "" })).toBe(LOGO);
  });
  it("sin logo (con o sin imagen de fondo): ninguna imagen, nunca la de fondo", () => {
    expect(imagenAlCompartirDeSucursal({ hero_imagen_fondo_url: FONDO })).toBeNull();
    expect(imagenAlCompartirDeSucursal({ restaurante_logo_url: "", hero_imagen_fondo_url: FONDO })).toBeNull();
    expect(imagenAlCompartirDeSucursal({})).toBeNull();
  });
  it("un logo que no es https permitido: ninguna imagen (no se cae a la de fondo)", () => {
    expect(imagenAlCompartirDeSucursal({ restaurante_logo_url: "http://cdn.ejemplo.test/logo.png", hero_imagen_fondo_url: FONDO })).toBeNull();
    expect(imagenAlCompartirDeSucursal({ restaurante_logo_url: "javascript:alert(1)" })).toBeNull();
  });
});
