import { appendFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { correrPuerta, prepararEntorno, soltarEntorno } from "./ejecutar";
import { escenariosDe } from "./escenarios";
import { EN_LA_SUCURSAL_VACIA, PENDIENTES_DE_SUCURSAL, RECHAZOS_CRUDOS_DE_LA_BASE, SIN_MARCA_PROPIA } from "./excepciones";
import type { Familia } from "./familias";
import { GENERADORES } from "./generadores";
import { inventariarPuertas, type PuertaInventariada } from "./inventario-de-puertas";
import { limpiarMundo, sembrarMundo, type Mundo } from "./mundo";

/**
 * Registra la matriz de denegación por defecto (GT-3b) para el subconjunto de puertas que elige `filtro`. Cada archivo `denegacion-por-defecto-<familia>.test.ts` la llama con su familia y declara antes
 * `vi.mock("../../src/core/auth/session", () => ({ getUsuarioActual: vi.fn() }))` (el `vi.mock` tiene que estar en el archivo del test).
 *
 * Los escenarios de cada puerta salen de `escenarios.ts`. Lo que es de OTRA SUCURSAL de la misma empresa y todavía no se defiende (la pista RLS por sucursal, fase a del plan §6) está en
 * `PENDIENTES_DE_SUCURSAL`: se ejecuta y se EXIGE que siga fallando; cuando se arregla, el test pide sacarla de la lista (la lista solo se achica).
 */
const informe: string[] = [];

/**
 * Los argumentos para el mensaje de un fallo. El `db` (un cliente de Prisma, un `Proxy` enorme y circular) NO se serializa nunca —hacerlo cuelga el proceso—: se lo reconoce por el nombre de su parámetro.
 * El resto se recorre con profundidad acotada.
 */
function mostrar(puerta: PuertaInventariada, argumentos: unknown[] | null): string {
  const recortar = (v: unknown, nivel: number): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (v instanceof Date) return v.toISOString();
    if (nivel > 3) return "<…>";
    if (Array.isArray(v)) return v.slice(0, 5).map((x) => recortar(x, nivel + 1));
    if (Object.getPrototypeOf(v) !== Object.prototype) return "<objeto>";
    return Object.fromEntries(Object.entries(v).slice(0, 12).map(([k, x]) => [k, recortar(x, nivel + 1)]));
  };
  const visibles = (argumentos ?? []).map((a, i) => (["db", "tx"].includes(puerta.parametros[i]?.nombre ?? "") ? "<db>" : recortar(a, 0)));
  return JSON.stringify(visibles).slice(0, 400);
}

export function definirMatriz({ nombre, filtro }: Familia): void {
  const puertas = inventariarPuertas().filter(filtro);
  describe(`GT-3b matriz de denegación — ${nombre}`, () => {
    let mundo: Mundo;
    beforeAll(async () => {
      await limpiarMundo();
      mundo = await sembrarMundo();
      prepararEntorno();
    }, 120_000);
    afterAll(async () => {
      soltarEntorno();
      await limpiarMundo();
      // Para revisar a mano qué respondió cada puerta: `MATRIZ_INFORME=<archivo> npx vitest run …` (solo en desarrollo; no forma parte del gate).
      if (process.env.MATRIZ_INFORME) appendFileSync(process.env.MATRIZ_INFORME, `${informe.join("\n")}\n`);
    }, 60_000);

    it("la familia no está vacía", () => {
      expect(puertas.length, `ninguna puerta cae en la familia «${nombre}»`).toBeGreaterThan(0);
    });

    for (const puerta of puertas) {
      const escenarios = escenariosDe(puerta);
      if (escenarios.length === 0) continue;
      describe(puerta.clave, () => {
        for (const escenario of escenarios) {
          const clavePendiente = `${puerta.clave}|${escenario}`;
          const pendiente = Object.hasOwn(PENDIENTES_DE_SUCURSAL, clavePendiente);
          it(`${escenario}${pendiente ? " (PENDIENTE de la pista RLS por sucursal: se exige que siga fallando)" : ""}`, async () => {
            const r = await correrPuerta(puerta, escenario, mundo, GENERADORES, { sinMarcaPropia: Object.hasOwn(SIN_MARCA_PROPIA, puerta.clave), rechazoCrudoDeLaBase: Object.hasOwn(RECHAZOS_CRUDOS_DE_LA_BASE, clavePendiente), enLaSucursalVacia: Object.hasOwn(EN_LA_SUCURSAL_VACIA, puerta.clave) });
            for (const [i, s] of r.salidas.entries()) informe.push(`${puerta.clave.padEnd(90)} ${escenario.padEnd(14)} ${r.veredictos[i].padEnd(8)} ${r.problemas.length ? "PROBLEMAS " : ""}${s.texto.replace(/\s+/g, " ").slice(0, 110)}`);
            if (pendiente) {
              expect(r.problemas.length, `${clavePendiente} ya no falla: sacala de PENDIENTES_DE_SUCURSAL (la defensa por sucursal llegó)`).toBeGreaterThan(0);
              return;
            }
            // El mensaje se arma SOLO si hay problemas: serializar un argumento `db` (un cliente de Prisma) entero cuelga el proceso.
            if (r.problemas.length) expect.fail(`${clavePendiente}\n  ${r.problemas.join("\n  ")}\n  argumentos: ${mostrar(puerta, r.planteo.argumentos)}\n  salida: ${r.salidas.map((s) => s.texto.slice(0, 200)).join(" || ")}`);
          });
        }
      });
    }
  });
}
