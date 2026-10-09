import { describe, expect, it } from "vitest";
import { permitirRolPrivilegiado } from "../../src/core/auth/rol-de-ejecucion";

/**
 * Pureza 0.4 (hallazgo H1 de la auditoría) + S-32: el escape `MOTOR2_ROL_ESTRICTO=0` (operar con un rol que salta el RLS) vale solo para las herramientas de demo, sobre una BASE
 * DESCARTABLE. Se decide por la base y por el entorno, nunca por la sola variable: en cualquier despliegue de Vercel (Producción, Preview, Development) se IGNORA aunque esté puesta, y
 * fuera de Vercel solo con una base local o cuyo nombre termina en `_dev`, `_e2e`, `_demo` o `_bench`. Defensa en profundidad además de que el arranque se niega
 * (`escapesProhibidosEnProduccion`, test/core/env.test.ts). Sin base de datos: es una función pura sobre el entorno.
 */
const LOCAL = "postgresql://motor2:motor2@localhost:5432/motor2_dev";
const NEON = "postgresql://app:clave@ep-ejemplo-123-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("permitirRolPrivilegiado: el escape de rol solo existe sobre una base descartable fuera de Vercel", () => {
  it("fuera de Vercel y con una base local o descartable, solo el valor «0» lo permite", () => {
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: LOCAL })).toBe(true);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: "postgresql://motor2:motor2@127.0.0.1:5432/cualquiera" })).toBe(true);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: "postgresql://motor2:motor2@[::1]:5432/cualquiera" })).toBe(true);
    // Con el entorno estricto pedido fuera de Vercel el escape tampoco vale (auditoría de la Fase 0, 0.4).
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: LOCAL, MOTOR2_ENTORNO_ESTRICTO: "1" })).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: LOCAL, MOTOR2_ENTORNO_ESTRICTO: "0" })).toBe(true);
  });

  it.each(["motor2_dev", "motor2_e2e", "motor2_demo", "motor2_bench"])("S-32: una base con nombre «%s» es descartable aunque el host no sea local", (nombre) => {
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: `postgresql://u:x@db.ejemplo.test:5432/${nombre}?sslmode=require` })).toBe(true);
  });

  it("S-32: una base que no es local ni se llama como una descartable (la de Neon, la de producción) NO admite el escape", () => {
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: NEON })).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: "postgresql://u:x@db.ejemplo.test:5432/motor2_produccion" })).toBe(false);
    // el sufijo es del NOMBRE de la base, no de cualquier parte de la URL ni un nombre que solo lo contiene
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: "postgresql://u:x@db.ejemplo.test:5432/produccion?application_name=motor2_dev" })).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: "postgresql://u:x@db.ejemplo.test:5432/motor2_dev_viejo" })).toBe(false);
    // un host que empieza con «localhost» pero es otro
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: "postgresql://u:x@localhost.malo.test:5432/produccion" })).toBe(false);
  });

  it("S-32: sin DATABASE_URL, con una que no se entiende o vacía, falla cerrado", () => {
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0" })).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: "" })).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: "no es una url" })).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: "postgresql://u:x@localhost:5432" })).toBe(true); // host local sin nombre: local alcanza
  });

  it("S-32: en CUALQUIER despliegue de Vercel el escape se ignora, con base local o descartable y con el «0» puesto", () => {
    for (const vercel of [{ VERCEL: "1", VERCEL_ENV: "preview" }, { VERCEL: "1", VERCEL_ENV: "development" }, { VERCEL: "1" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }]) {
      expect(permitirRolPrivilegiado({ ...vercel, MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: LOCAL }), JSON.stringify(vercel)).toBe(false);
      expect(permitirRolPrivilegiado({ ...vercel, MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: NEON }), JSON.stringify(vercel)).toBe(false);
    }
  });

  it("sin la variable, o con cualquier otro valor, el rol es estricto", () => {
    expect(permitirRolPrivilegiado({ DATABASE_URL: LOCAL })).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "1", DATABASE_URL: LOCAL })).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "", DATABASE_URL: LOCAL })).toBe(false);
    expect(permitirRolPrivilegiado({ MOTOR2_ROL_ESTRICTO: "false", DATABASE_URL: LOCAL })).toBe(false);
  });

  it("en Producción de Vercel se ignora SIEMPRE, con el «0» puesto", () => {
    expect(permitirRolPrivilegiado({ VERCEL_ENV: "production", MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: LOCAL })).toBe(false);
    expect(permitirRolPrivilegiado({ VERCEL_ENV: "production", DATABASE_URL: LOCAL })).toBe(false);
  });
});
