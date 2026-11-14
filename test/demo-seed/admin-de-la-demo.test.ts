import { describe, expect, it } from "vitest";
import { EMAIL_ADMIN_DE_LA_DEMO_POR_DEFECTO, VARIABLE_DEL_ADMIN_DE_LA_DEMO, emailAdminDeLaDemo } from "../../scripts/demo-seed/admin-de-la-demo";

/**
 * El administrador de la demo sale de `MOTOR2_DEMO_ADMIN_EMAIL` (ya no es un correo fijo en el código). Todo nace cerrado: sin variable, un correo genérico que no existe; una forma rara se rechaza.
 */
const conVariable = (valor: string | undefined) => ({ [VARIABLE_DEL_ADMIN_DE_LA_DEMO]: valor });

describe("emailAdminDeLaDemo", () => {
  it("sin la variable, o vacía o solo espacios, usa el correo genérico por defecto", () => {
    for (const env of [{}, conVariable(undefined), conVariable(""), conVariable("   ")]) expect(emailAdminDeLaDemo(env)).toBe(EMAIL_ADMIN_DE_LA_DEMO_POR_DEFECTO);
  });

  it("el correo por defecto es genérico: dominio de ejemplo, sin nombre de persona", () => {
    expect(EMAIL_ADMIN_DE_LA_DEMO_POR_DEFECTO).toBe("admin-demo@ejemplo.test");
  });

  it("con la variable declarada devuelve ese correo recortado y en minúsculas", () => {
    expect(emailAdminDeLaDemo(conVariable("  Persona.Admin+demo@Ejemplo.com  "))).toBe("persona.admin+demo@ejemplo.com");
  });

  it.each(["sin-arroba", "dos@@ejemplo.com", "a b@ejemplo.com", "a@ejemplo", "a@.com", "@ejemplo.com", "a@ejemplo.c", "a@ejemplo.com;drop", "a@ejemplo.com\nb@x.com", "<a@ejemplo.com>", `${"x".repeat(65)}@ejemplo.com`])("una variable con forma rara (%j) se rechaza, no se arregla", (valor) => {
    expect(() => emailAdminDeLaDemo(conVariable(valor))).toThrow(/MOTOR2_DEMO_ADMIN_EMAIL no tiene forma de correo/);
  });

  it("es pura: no lee process.env, solo el entorno que se le pasa", () => {
    const antes = process.env[VARIABLE_DEL_ADMIN_DE_LA_DEMO];
    process.env[VARIABLE_DEL_ADMIN_DE_LA_DEMO] = "otro@ejemplo.com";
    try {
      expect(emailAdminDeLaDemo({})).toBe(EMAIL_ADMIN_DE_LA_DEMO_POR_DEFECTO);
    } finally {
      if (antes === undefined) delete process.env[VARIABLE_DEL_ADMIN_DE_LA_DEMO];
      else process.env[VARIABLE_DEL_ADMIN_DE_LA_DEMO] = antes;
    }
  });
});
