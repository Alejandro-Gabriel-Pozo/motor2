import { describe, expect, it } from "vitest";
import { validarTextoCatalogo } from "@/core/texto";

// Sin base de datos: `validarTextoCatalogo` es pura.
describe("validarTextoCatalogo — nombres de catálogo", () => {
  it.each(["Muzzarella", "Coca-Cola 500 cc", "Salsa (casera)", "Pan & Queso", "Jamón cocido 100% natural", "Harina 000/0000", "D'Oro"])(
    "acepta un nombre normal: %s",
    (nombre) => {
      expect(validarTextoCatalogo(nombre, "El nombre")).toBeNull();
    }
  );

  it.each(["=1+1", "+cmd", "@SUM(A1)", '="x"', "a|b", "a!b", "a;b", "a\tb"])("rechaza caracteres fuera del charset: %j", (nombre) => {
    expect(validarTextoCatalogo(nombre, "El nombre")).toContain("caracteres no permitidos");
  });

  it.each(["-A1", "-SUM(1,2)", "-1-1", "- Promo"])("rechaza un nombre que empieza con '-' (disparador de fórmula que el charset permite): %s", (nombre) => {
    expect(validarTextoCatalogo(nombre, "El nombre")).toBe('El nombre no puede empezar con "-".');
  });

  it("un '-' en el medio o al final sigue permitido", () => {
    expect(validarTextoCatalogo("Coca-Cola", "El nombre")).toBeNull();
    expect(validarTextoCatalogo("Combo 2 -", "El nombre")).toBeNull();
  });

  it("un valor vacío no es asunto de este validador (el 'obligatorio' se chequea aparte)", () => {
    expect(validarTextoCatalogo("", "El nombre")).toBeNull();
    expect(validarTextoCatalogo("   ", "El nombre")).toBeNull();
  });

  it("rechaza más de 80 caracteres", () => {
    expect(validarTextoCatalogo("a".repeat(81), "El nombre")).toContain("80 caracteres");
    expect(validarTextoCatalogo("a".repeat(80), "El nombre")).toBeNull();
  });
});
