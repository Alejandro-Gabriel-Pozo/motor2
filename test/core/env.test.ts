import { describe, expect, it } from "vitest";
import { parseEnv, validarDominioCartaAlArrancar, validarEmpresaUnicaAlArrancar, validarEntornoAlArrancar } from "../../src/env";

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
      CARTA_DOMINIO_BASE: "motor2carta.com",
      NEXT_PUBLIC_SENTRY_DSN: "https://sentry.example.com/1",
    };
    expect(() => parseEnv(conOpcionales)).not.toThrow();
    expect(() => parseEnv(ENV_VALIDO)).not.toThrow(); // ENV_VALIDO ya no tiene ninguna opcional
  });

  it("hallazgo real (2026-09-28): con AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET vacíos (como los dejaba un .env local sin login real) parseEnv rechaza, aunque lo demás esté completo", () => {
    // No es un bug del schema: son requeridas de verdad (sin ellas, un login real con Google fallaría en producción). Un .env local las
    // dejaba vacías porque toda la suite mockea la sesión (getUsuarioActual) y nunca pasa por el login de Google. La fuente es EXPLÍCITA:
    // este test no lee process.env ni el .env de quien lo corre (en CI esas variables vienen con valores de relleno).
    const googleVacio = { ...ENV_VALIDO, AUTH_GOOGLE_ID: "", AUTH_GOOGLE_SECRET: "" };
    expect(() => parseEnv(googleVacio)).toThrow();

    // Solo Google falta: con valores, la misma fuente es válida — el rechazo es por esos dos campos y no por otra cosa.
    expect(() => parseEnv({ ...googleVacio, AUTH_GOOGLE_ID: "id-de-prueba", AUTH_GOOGLE_SECRET: "secreto-de-prueba" })).not.toThrow();
  });
});

const ENV_PRODUCCION: Record<string, string> = { ...ENV_VALIDO, AUTH_SECRET: "x".repeat(32), CRON_SECRET: "cron-secreto" };

describe("parseEnv en modo producción (S-20)", () => {
  it("exige AUTH_SECRET de al menos 32 caracteres y CRON_SECRET; el modo normal no", () => {
    expect(() => parseEnv(ENV_PRODUCCION, true)).not.toThrow();
    expect(() => parseEnv({ ...ENV_PRODUCCION, AUTH_SECRET: "x".repeat(31) }, true)).toThrow();
    expect(() => parseEnv({ ...ENV_VALIDO, AUTH_SECRET: "x".repeat(32) }, true)).toThrow();
    expect(() => parseEnv({ ...ENV_VALIDO, AUTH_SECRET: "corto" })).not.toThrow();
  });
});

describe("validarEntornoAlArrancar (S-20)", () => {
  it("en Producción de Vercel no arranca con una variable ausente y el error nombra la variable, sin valores", () => {
    const sinCron = { ...ENV_PRODUCCION, VERCEL_ENV: "production" } as Record<string, string | undefined>;
    delete sinCron.CRON_SECRET;
    expect(() => validarEntornoAlArrancar(sinCron)).toThrow(/CRON_SECRET/);
    expect(() => validarEntornoAlArrancar({ ...ENV_PRODUCCION, VERCEL_ENV: "production", AUTH_SECRET: "corto-secreto" })).toThrow(/AUTH_SECRET .debe tener al menos 32/);
    expect(() => validarEntornoAlArrancar({ ...ENV_PRODUCCION, VERCEL_ENV: "production", AUTH_SECRET: "corto-secreto" })).not.toThrow(/corto-secreto/);
    expect(() => validarEntornoAlArrancar({ ...ENV_PRODUCCION, VERCEL_ENV: "production" })).not.toThrow();
  });

  it("MOTOR2_ENTORNO_ESTRICTO=1 lo exige fuera de Vercel; =0 relaja solo CRON_SECRET y el largo de AUTH_SECRET", () => {
    expect(() => validarEntornoAlArrancar({ ...ENV_VALIDO, MOTOR2_ENTORNO_ESTRICTO: "1" })).toThrow();
    expect(() => validarEntornoAlArrancar({ ...ENV_VALIDO, VERCEL_ENV: "production", MOTOR2_ENTORNO_ESTRICTO: "0" })).not.toThrow();
    expect(() => validarEntornoAlArrancar({ VERCEL_ENV: "production", MOTOR2_ENTORNO_ESTRICTO: "0" })).toThrow(/DATABASE_URL/);
  });

  it("local, e2e (NODE_ENV=production sin VERCEL_ENV) y Preview no validan nada, aunque falte todo", () => {
    expect(() => validarEntornoAlArrancar({})).not.toThrow();
    expect(() => validarEntornoAlArrancar({ NODE_ENV: "production" })).not.toThrow();
    expect(() => validarEntornoAlArrancar({ VERCEL_ENV: "preview" })).not.toThrow();
  });
});

describe("validarDominioCartaAlArrancar (CARTA_DOMINIO_BASE: build vs arranque)", () => {
  const PROD = { VERCEL_ENV: "production" };

  it("en Producción no arranca si la variable del arranque difiere de la que vio el build (en cualquier sentido)", () => {
    expect(() => validarDominioCartaAlArrancar({ ...PROD, CARTA_DOMINIO_BASE: "carta.ejemplo.com" }, "")).toThrow(/CARTA_DOMINIO_BASE difiere/);
    expect(() => validarDominioCartaAlArrancar({ ...PROD }, "carta.ejemplo.com")).toThrow(/CARTA_DOMINIO_BASE difiere/);
    expect(() => validarDominioCartaAlArrancar({ ...PROD, CARTA_DOMINIO_BASE: "otra.ejemplo.com" }, "carta.ejemplo.com")).toThrow(/CARTA_DOMINIO_BASE difiere/);
  });

  it("el error no revela los dominios", () => {
    expect(() => validarDominioCartaAlArrancar({ ...PROD, CARTA_DOMINIO_BASE: "secreta.ejemplo.com" }, "")).not.toThrow(/secreta.ejemplo/);
  });

  it("iguales (sin importar mayúsculas ni espacios) o ambas vacías: arranca", () => {
    expect(() => validarDominioCartaAlArrancar({ ...PROD, CARTA_DOMINIO_BASE: " Carta.Ejemplo.com " }, "carta.ejemplo.com")).not.toThrow();
    expect(() => validarDominioCartaAlArrancar({ ...PROD }, "")).not.toThrow();
  });

  it("sin bundle compilado (compilado indefinido) o fuera del entorno estricto, no compara nada", () => {
    expect(() => validarDominioCartaAlArrancar({ ...PROD, CARTA_DOMINIO_BASE: "carta.ejemplo.com" }, undefined)).not.toThrow();
    expect(() => validarDominioCartaAlArrancar({ CARTA_DOMINIO_BASE: "carta.ejemplo.com" }, "")).not.toThrow();
    expect(() => validarDominioCartaAlArrancar({ VERCEL_ENV: "preview", CARTA_DOMINIO_BASE: "carta.ejemplo.com" }, "")).not.toThrow();
    expect(() => validarDominioCartaAlArrancar({ MOTOR2_ENTORNO_ESTRICTO: "1", CARTA_DOMINIO_BASE: "carta.ejemplo.com" }, "")).toThrow();
  });
});

describe("CARTA_EMPRESA_UNICA (add-on de la empresa única)", () => {
  it("es opcional, pero si viene tiene que ser un slug (parseEnv la rechaza si no)", () => {
    expect(() => parseEnv({ ...ENV_VALIDO, CARTA_DOMINIO_BASE: "carta.ejemplo.com", CARTA_EMPRESA_UNICA: "hoteles-neuquen" })).not.toThrow();
    for (const malo of ["X", "a--b", "a.b", "-x", "https://x", ""]) {
      expect(() => parseEnv({ ...ENV_VALIDO, CARTA_EMPRESA_UNICA: malo }), malo).toThrow(/CARTA_EMPRESA_UNICA/);
    }
  });

  it("en Producción un valor inválido impide arrancar y el error nombra la variable", () => {
    expect(() => validarEntornoAlArrancar({ ...ENV_PRODUCCION, VERCEL_ENV: "production", CARTA_EMPRESA_UNICA: "No Valido" })).toThrow(/CARTA_EMPRESA_UNICA/);
  });
});

describe("validarEmpresaUnicaAlArrancar (CARTA_EMPRESA_UNICA: build vs arranque)", () => {
  const PROD = { VERCEL_ENV: "production" };

  it("en Producción no arranca si la variable del arranque difiere de la que vio el build (en cualquier sentido), sin revelar el slug", () => {
    expect(() => validarEmpresaUnicaAlArrancar({ ...PROD, CARTA_EMPRESA_UNICA: "hoteles" }, "")).toThrow(/CARTA_EMPRESA_UNICA difiere/);
    expect(() => validarEmpresaUnicaAlArrancar({ ...PROD }, "hoteles")).toThrow(/CARTA_EMPRESA_UNICA difiere/);
    expect(() => validarEmpresaUnicaAlArrancar({ ...PROD, CARTA_EMPRESA_UNICA: "otra" }, "hoteles")).toThrow(/CARTA_EMPRESA_UNICA difiere/);
    expect(() => validarEmpresaUnicaAlArrancar({ ...PROD, CARTA_EMPRESA_UNICA: "secreta" }, "")).not.toThrow(/secreta/);
  });

  it("iguales o ambas vacías: arranca", () => {
    expect(() => validarEmpresaUnicaAlArrancar({ ...PROD, CARTA_EMPRESA_UNICA: "hoteles" }, "hoteles")).not.toThrow();
    expect(() => validarEmpresaUnicaAlArrancar({ ...PROD }, "")).not.toThrow();
  });

  it("sin bundle compilado (compilado indefinido) o fuera del entorno estricto, no compara nada", () => {
    expect(() => validarEmpresaUnicaAlArrancar({ ...PROD, CARTA_EMPRESA_UNICA: "hoteles" }, undefined)).not.toThrow();
    expect(() => validarEmpresaUnicaAlArrancar({ CARTA_EMPRESA_UNICA: "hoteles" }, "")).not.toThrow();
    expect(() => validarEmpresaUnicaAlArrancar({ VERCEL_ENV: "preview", CARTA_EMPRESA_UNICA: "hoteles" }, "")).not.toThrow();
    expect(() => validarEmpresaUnicaAlArrancar({ MOTOR2_ENTORNO_ESTRICTO: "1", CARTA_EMPRESA_UNICA: "hoteles" }, "")).toThrow();
  });
});
