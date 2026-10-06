import { describe, expect, it } from "vitest";
import { emailDeContactoDePlataforma } from "../../src/core/auth/contacto-plataforma";

describe("emailDeContactoDePlataforma", () => {
  it("devuelve el email configurado, sin espacios", () => {
    expect(emailDeContactoDePlataforma({ CONTACTO_PLATAFORMA_EMAIL: "  soporte@plataforma.test " })).toBe("soporte@plataforma.test");
  });

  it("sin configurar, vacío o con algo que no es un email: ninguno (no se muestra nada)", () => {
    for (const v of [undefined, "", "   ", "no-es-un-email", "javascript:alert(1)", "a@b"]) {
      expect(emailDeContactoDePlataforma({ CONTACTO_PLATAFORMA_EMAIL: v }), String(v)).toBeNull();
    }
  });
});
