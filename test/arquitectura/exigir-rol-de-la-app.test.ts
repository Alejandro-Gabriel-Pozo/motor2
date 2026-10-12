import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIGRACION_B1_FUNCIONES } from "../setup/migraciones-de-alcance-de-sucursal";

/**
 * Paquete 1, B1: `EXIGIR_ROL_DE_LA_APP` (`src/server/sesion/base.ts`) va ATADO a la migración B1. Con la migración presente, la app tiene que negarse a operar con un rol que no sea
 * `motor2_app` (las políticas por sucursal son `TO motor2_app`: con otro rol no rigen y la separación por sucursal quedaría sin efecto). Con `true` y SIN la migración B1 en
 * `prisma/migrations`, el valor es un defecto (se negaría a operar sobre una base que todavía no tiene las políticas): se pone en rojo. Sin base de datos.
 */
const RAIZ = join(__dirname, "../..");
const FUENTE = join(RAIZ, "src/server/sesion/base.ts");

/** El valor literal de la constante, o `null` si no se la encuentra con la forma esperada (se trata como defecto). */
function valorDeLaConstante(fuente: string): boolean | null {
  const m = /^const EXIGIR_ROL_DE_LA_APP = (true|false);$/m.exec(fuente);
  return m ? m[1] === "true" : null;
}

/** Los defectos del par (valor, ¿está la migración B1?): vacío = coherentes. */
function defectos(valor: boolean | null, hayB1: boolean): string[] {
  if (valor === null) return ["no se encontró `const EXIGIR_ROL_DE_LA_APP = true|false;` en src/server/sesion/base.ts"];
  if (valor && !hayB1) return ["EXIGIR_ROL_DE_LA_APP es true pero la migración B1 no está en prisma/migrations: la app se negaría a operar sobre una base sin políticas de sucursal"];
  if (!valor && hayB1) return ["la migración B1 está en prisma/migrations pero EXIGIR_ROL_DE_LA_APP sigue en false: las políticas por sucursal no regirían con un rol ajeno a motor2_app"];
  return [];
}

const hayB1 = () => existsSync(join(RAIZ, "prisma/migrations", MIGRACION_B1_FUNCIONES, "migration.sql"));

describe("EXIGIR_ROL_DE_LA_APP va atado a la migración B1", () => {
  it("con la migración B1 presente, el valor es true (y coherente)", () => {
    const valor = valorDeLaConstante(readFileSync(FUENTE, "utf8"));
    expect(hayB1(), "la migración B1 está en prisma/migrations").toBe(true);
    expect(valor).toBe(true);
    expect(defectos(valor, hayB1())).toEqual([]);
  });

  it("la mutación: true sin B1 y false con B1 son defectos, y una forma que no se reconoce también", () => {
    expect(defectos(true, false)).toHaveLength(1);
    expect(defectos(false, true)).toHaveLength(1);
    expect(defectos(true, true)).toEqual([]);
    expect(defectos(false, false)).toEqual([]);
    expect(defectos(valorDeLaConstante("const EXIGIR_ROL_DE_LA_APP = !!1;"), true)).toHaveLength(1);
    expect(valorDeLaConstante("const EXIGIR_ROL_DE_LA_APP = false;")).toBe(false);
  });
});
