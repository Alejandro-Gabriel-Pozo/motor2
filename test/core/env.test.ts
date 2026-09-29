import "dotenv/config";
import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/env";

/**
 * Fase 1.2 del checklist de multi-tenancy (Downloads/Motor 2/motor2-multitenancy-checklist (1).md): confirma que el schema de
 * `src/env.ts` refleja EXACTAMENTE lo que este repo necesita — no el ejemplo del checklist (que tenía 3 variables y
 * `MULTI_TENANT_ENABLED`, que no existe hoy). `parseEnv` no lee `process.env` sola: cada test le pasa una fuente explícita, para
 * que cada caso aísle EXACTAMENTE qué campo está probando (mismo criterio "no enmascarar la causa real" que
 * `test/invariantes/aislamiento-sucursal.test.ts`, Fase 0.3) — un objeto derivado de `process.env` sin más cuidado arrastraría
 * el hallazgo de abajo (AUTH_GOOGLE_ID/SECRET vacíos en el `.env` local) a CADA test, confundiendo cuál campo faltante es el que
 * realmente se está probando en cada caso.
 */
const ENV_VALIDO: Record<string, string> = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
  AUTH_SECRET: "secreto-de-prueba",
  AUTH_GOOGLE_ID: "id-de-prueba",
  AUTH_GOOGLE_SECRET: "secreto-de-prueba",
};

describe("parseEnv", () => {
  it("acepta un env con las 5 requeridas completas, sin ninguna opcional", () => {
    expect(() => parseEnv(ENV_VALIDO)).not.toThrow();
  });

  it("rechaza si falta (o está vacía) cualquiera de las 5 requeridas, una por vez", () => {
    for (const clave of Object.keys(ENV_VALIDO)) {
      const sinEsa = { ...ENV_VALIDO };
      delete sinEsa[clave];
      expect(() => parseEnv(sinEsa), `sin ${clave} debería rechazar`).toThrow();

      expect(() => parseEnv({ ...ENV_VALIDO, [clave]: "" }), `${clave} vacía debería rechazar`).toThrow();
    }
  });

  it("acepta con TODAS las opcionales presentes, y con NINGUNA — nunca las exige", () => {
    const conOpcionales = {
      ...ENV_VALIDO,
      ALLOWED_EMAIL_DOMAINS: "lacuadra.com",
      BOOTSTRAP_ADMIN_EMAILS: "admin@lacuadra.com",
      CRON_SECRET: "cron-secreto",
      CARTA_API_TOKEN: "token",
      CARTA_PORTAL_URL: "https://carta.example.com",
      CARTA_EMPRESA_SLUG: "la-cuadra",
      CARTA_DOMINIO_BASE: "motor2carta.com",
      NEXT_PUBLIC_SENTRY_DSN: "https://sentry.example.com/1",
    };
    expect(() => parseEnv(conOpcionales)).not.toThrow();
    expect(() => parseEnv(ENV_VALIDO)).not.toThrow(); // ENV_VALIDO ya no tiene ninguna opcional
  });

  it("hallazgo real (2026-09-28): el .env LOCAL de este repo tiene AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET vacíos — parseEnv los rechaza, correctamente", () => {
    // No es un bug del schema: son requeridas de verdad (sin ellas, un login real con Google fallaría en producción). Lo que
    // pasa es que este .env LOCAL nunca las necesitó: toda la suite de tests mockea la sesión (getUsuarioActual), sin pasar
    // nunca por el login real de Google. Documentado acá para no repetir la sorpresa de "por qué esto no arranca" el día que
    // esta validación se conecte al arranque real.
    expect(process.env.AUTH_GOOGLE_ID).toBe("");
    expect(process.env.AUTH_GOOGLE_SECRET).toBe("");
    expect(() => parseEnv(process.env)).toThrow();

    // DATABASE_URL/DIRECT_URL/AUTH_SECRET sí están completas en el .env local — solo Google falta.
    expect(process.env.DATABASE_URL).toBeTruthy();
    expect(process.env.DIRECT_URL).toBeTruthy();
    expect(process.env.AUTH_SECRET).toBeTruthy();
  });
});
