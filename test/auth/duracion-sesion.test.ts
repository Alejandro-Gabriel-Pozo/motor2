import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTUALIZAR_CADA_S, DURACION_SESION_S } from "../../src/core/auth/duracion-sesion";

/**
 * La sesión vence a las 12 horas sin actividad (no los 30 días que trae Auth.js por defecto): en una tablet compartida del local,
 * una sesión olvidada abierta no puede seguir sirviendo un mes.
 */
describe("duración de la sesión", () => {
  it("es de 12 horas y se renueva, con uso, cada hora (siempre menos que lo que dura)", () => {
    expect(DURACION_SESION_S).toBe(12 * 60 * 60);
    expect(ACTUALIZAR_CADA_S).toBe(60 * 60);
    expect(ACTUALIZAR_CADA_S).toBeLessThan(DURACION_SESION_S);
  });

  it("la configuración de Auth.js usa esos valores (si no, quedaría el valor por defecto de 30 días)", () => {
    const auth = readFileSync(join(__dirname, "../../src/lib/auth.ts"), "utf8");
    expect(auth).toMatch(/session:\s*\{[^}]*strategy:\s*"database"[^}]*maxAge:\s*DURACION_SESION_S[^}]*updateAge:\s*ACTUALIZAR_CADA_S/);
  });
});
