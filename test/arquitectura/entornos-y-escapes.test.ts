import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { permitirRolPrivilegiado } from "../../src/core/auth/rol-de-ejecucion";
import { escapesProhibidosEnProduccion } from "../../src/env";
import { modoDeMigracionEnBuild } from "../../scripts/construir";

/**
 * GT-19 y GT-22 (S-31, S-32): los escapes de desarrollo no tienen efecto en un despliegue de Vercel que no sea Producción, y el build y los escapes se deciden por el ENTORNO y la BASE, nunca por
 * la sola variable. Un entorno menos confiable (Preview) nunca ejecuta con el privilegio de uno más confiable (Producción): el Preview de `stockhneuquen` comparte la base de producción (ADR-007).
 * Se prueba por producto cartesiano de entornos, no por casos sueltos: una combinación nueva que se escape es un rojo.
 */
const RAIZ = join(__dirname, "../..");

const VERCEL = [undefined, "1"];
const VERCEL_ENV = [undefined, "", "production", "preview", "development"];
const MIGRAR = [undefined, "", "0", "1", "si", "true"];
const ROL = [undefined, "0", "1"];
const BASES = [undefined, "postgresql://u:x@localhost:5432/motor2_dev", "postgresql://u:x@ep-1.us-east-2.aws.neon.tech/neondb", "postgresql://u:x@db.ejemplo.test/motor2_demo"];

type Fuente = Record<string, string | undefined>;
const fuente = (v: Fuente): Fuente => Object.fromEntries(Object.entries(v).filter(([, valor]) => valor !== undefined));
/** Un despliegue de Vercel que NO es de Producción: hay `VERCEL` (o `VERCEL_ENV`) y el entorno no es `production`. */
const enVercel = (e: Fuente) => Boolean(e.VERCEL || e.VERCEL_ENV);
const vercelNoProduccion = (e: Fuente) => enVercel(e) && e.VERCEL_ENV !== "production";

describe("GT-19: el build nunca migra fuera de Producción de Vercel", () => {
  it("en Vercel con VERCEL_ENV distinto de «production» el modo es siempre omitir o rechazar, sea cual sea MOTOR2_MIGRAR_EN_BUILD", () => {
    let combinaciones = 0;
    for (const v of VERCEL) for (const ve of VERCEL_ENV) for (const m of MIGRAR) {
      const e = fuente({ VERCEL: v, VERCEL_ENV: ve, MOTOR2_MIGRAR_EN_BUILD: m });
      if (!(e.VERCEL && e.VERCEL_ENV !== "production")) continue;
      combinaciones++;
      expect(["omitir", "rechazar"], JSON.stringify(e)).toContain(modoDeMigracionEnBuild(e));
      expect(modoDeMigracionEnBuild(e), JSON.stringify(e)).toBe(e.MOTOR2_MIGRAR_EN_BUILD === "1" ? "rechazar" : "omitir");
    }
    expect(combinaciones, "el recorrido no puede quedar vacío").toBeGreaterThan(10);
  });
});

describe("GT-19: los escapes de desarrollo no tienen efecto en Vercel", () => {
  it("MOTOR2_ROL_ESTRICTO=0 en cualquier despliegue de Vercel (con cualquier base): el escape se ignora y el arranque lo prohíbe", () => {
    let combinaciones = 0;
    for (const v of VERCEL) for (const ve of VERCEL_ENV) for (const base of BASES) {
      const e = fuente({ VERCEL: v, VERCEL_ENV: ve, MOTOR2_ROL_ESTRICTO: "0", DATABASE_URL: base });
      if (!enVercel(e)) continue;
      combinaciones++;
      expect(permitirRolPrivilegiado(e), JSON.stringify(e)).toBe(false);
      expect(escapesProhibidosEnProduccion(e), JSON.stringify(e)).not.toEqual([]);
    }
    expect(combinaciones).toBeGreaterThan(20);
  });

  it("fuera de Vercel, el escape solo vale con el «0» y una base local o descartable", () => {
    for (const rol of ROL) for (const base of BASES) {
      const e = fuente({ MOTOR2_ROL_ESTRICTO: rol, DATABASE_URL: base });
      const descartable = base !== undefined && base !== BASES[2];
      expect(permitirRolPrivilegiado(e), JSON.stringify(e)).toBe(rol === "0" && descartable);
    }
  });

  it("ningún despliegue de Vercel que no sea Producción acepta el escape (barrido completo del producto cartesiano)", () => {
    for (const v of VERCEL) for (const ve of VERCEL_ENV) for (const rol of ROL) for (const base of BASES) {
      const e = fuente({ VERCEL: v, VERCEL_ENV: ve, MOTOR2_ROL_ESTRICTO: rol, DATABASE_URL: base });
      if (vercelNoProduccion(e)) expect(permitirRolPrivilegiado(e), JSON.stringify(e)).toBe(false);
    }
  });
});

describe("GT-22: next.config.ts no anuncia el framework", () => {
  it("`poweredByHeader: false` (sin `X-Powered-By: Next.js`)", () => {
    const sf = ts.createSourceFile("next.config.ts", readFileSync(join(RAIZ, "next.config.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    let valor: string | undefined;
    const visitar = (n: ts.Node) => {
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "poweredByHeader") valor = n.initializer.getText(sf);
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
    expect(valor).toBe("false");
  });
});
