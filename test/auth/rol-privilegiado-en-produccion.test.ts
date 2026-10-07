import { describe, expect, it } from "vitest";
import { permitirRolPrivilegiado } from "../../src/core/auth/rol-de-ejecucion";

/**
 * Pureza 0.4 (hallazgo H1 de la auditoría): el escape `MOTOR2_ROL_ESTRICTO=0` (operar con un rol que salta el RLS) vale solo para las herramientas
 * de demo. En Producción de Vercel se IGNORA aunque la variable llegara a estar puesta: defensa en profundidad, además de que el arranque se niega
 * (`escapesProhibidosEnProduccion`, test/core/env.test.ts). Sin base de datos: es una función pura sobre el entorno.
 */
describe("permitirRolPrivilegiado: el escape de rol no existe en Producción", () => {
  it("fuera de Producción, solo el valor «0» lo permite", () => {
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0" })).toBe(true);
    // Con el entorno estricto pedido fuera de Vercel el escape tampoco vale (auditoría de la Fase 0, 0.4).
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", MOTOR2_ENTORNO_ESTRICTO: "1" })).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", MOTOR2_ENTORNO_ESTRICTO: "0" })).toBe(true);
    expect(permitirRolPrivilegiado({ VERCEL_ENV: "preview", MOTOR2_ROL_ESTRICTO: "0" })).toBe(true);
    expect(permitirRolPrivilegiado({ VERCEL_ENV: "development", MOTOR2_ROL_ESTRICTO: "0" })).toBe(true);
  });

  it("sin la variable, o con cualquier otro valor, el rol es estricto", () => {
    expect(permitirRolPrivilegiado({})).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "1" })).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "" })).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "false" })).toBe(false);
  });

  it("en Producción de Vercel se ignora SIEMPRE, con el «0» puesto", () => {
    expect(permitirRolPrivilegiado({ VERCEL_ENV: "production", MOTOR2_ROL_ESTRICTO: "0" })).toBe(false);
    expect(permitirRolPrivilegiado({ VERCEL_ENV: "production" })).toBe(false);
  });
});
