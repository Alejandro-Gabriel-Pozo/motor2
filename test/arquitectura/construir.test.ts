import { describe, expect, it } from "vitest";
import { debeMigrarEnBuild } from "../../scripts/construir";

describe("debeMigrarEnBuild — qué builds pueden aplicar migraciones", () => {
  it("migra en local y en el gate (sin Vercel), como siempre", () => {
    expect(debeMigrarEnBuild({})).toBe(true);
  });

  it("migra en un build de Producción de Vercel", () => {
    expect(debeMigrarEnBuild({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(true);
  });

  it.each(["preview", "development", undefined])("NO migra en Vercel con VERCEL_ENV=%s", (entorno) => {
    expect(debeMigrarEnBuild({ VERCEL: "1", VERCEL_ENV: entorno })).toBe(false);
  });

  it("MOTOR2_MIGRAR_EN_BUILD=1 fuerza la migración en un Preview", () => {
    expect(debeMigrarEnBuild({ VERCEL: "1", VERCEL_ENV: "preview", MOTOR2_MIGRAR_EN_BUILD: "1" })).toBe(true);
  });

  it("MOTOR2_MIGRAR_EN_BUILD=0 la apaga incluso en Producción o en local", () => {
    expect(debeMigrarEnBuild({ VERCEL: "1", VERCEL_ENV: "production", MOTOR2_MIGRAR_EN_BUILD: "0" })).toBe(false);
    expect(debeMigrarEnBuild({ MOTOR2_MIGRAR_EN_BUILD: "0" })).toBe(false);
  });

  it("un valor raro de MOTOR2_MIGRAR_EN_BUILD no cambia la decisión por defecto", () => {
    expect(debeMigrarEnBuild({ VERCEL: "1", VERCEL_ENV: "preview", MOTOR2_MIGRAR_EN_BUILD: "si" })).toBe(false);
  });
});
