import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ESCENARIOS, crearMundoDeSucursales, sqlBueno, type MundoDeSucursales } from "./rls-sucursal-mundo";

/**
 * M.3, Fase A, paso A10, contra Postgres REAL: el comportamiento de la RLS por sucursal con el SQL que genera el paso A9 (`test/setup/politicas-de-alcance-de-sucursal.ts`), aplicado sobre una base TEMPORAL
 * migrada (`crearBaseTemporalMigrada`) y NUNCA en `prisma/migrations`, conectado como el rol real `motor2_app`. Los escenarios (1)–(9) y (11) del plan viven en `rls-sucursal-mundo.ts` como funciones que
 * devuelven sus problemas: acá se afirma que no hay ninguno; `rls-sucursal-mutaciones.test.ts` afirma que un SQL roto o la base sin políticas SÍ los tienen.
 *
 * El rol `motor2_app` es del cluster: si no existe (un Postgres de CI sin el paso de roles) los casos se omiten con motivo, igual que `borrador-de-politicas-de-sucursal.test.ts`.
 */
let mundo: MundoDeSucursales;

beforeAll(async () => {
  mundo = await crearMundoDeSucursales();
  if (mundo.hayRol) await mundo.aplicar(sqlBueno());
}, 120_000);

afterAll(async () => {
  await mundo?.cerrar();
});

describe("RLS por sucursal con las políticas del generador, como motor2_app", () => {
  for (const escenario of ESCENARIOS) {
    it(escenario.titulo, async (ctx) => {
      if (!mundo.hayRol) return ctx.skip();
      const problemas = await escenario.correr(mundo);
      expect(problemas, problemas.join("\n")).toEqual([]);
    });
  }
});
