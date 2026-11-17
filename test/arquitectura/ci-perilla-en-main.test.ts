import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Perilla `CI_EN_MAIN` (docs/ci-perilla-ci-en-main-2026-11-15.md) y filtro de alcance (docs/ci-saltar-build-y-e2e-si-solo-docs-2026-11-17.md): en un push a `main` los trabajos pesados de `ci.yml` y `seguridad.yml` se omiten salvo que la variable de repositorio valga `si`.
 * Este guardián fija la regla de seguridad de esa perilla: la condición existe en CADA trabajo y NO puede omitir nada fuera de «push a main con la perilla apagada» (en particular, jamás un
 * `pull_request`: el Gate requerido de los PR sigue exigiendo todo). No compara texto contra una plantilla: EVALÚA la condición real del workflow sobre todas las combinaciones de evento, rama y valor
 * de la variable. La condición solo puede estar escrita con un conjunto cerrado de símbolos (lista de permitidos): cualquier otra cosa (una función, una variable, otro contexto) es un problema.
 *
 * Violaciones inyectadas (ver los `it`): sacar la condición de un trabajo, quitar la mitad `push`, quitar la mitad `main`, cambiar `&&` por `||`, usar otra variable, invertir la perilla,
 * dejar el gate en `always()` a secas, y una condición con un símbolo fuera de la lista.
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8").replace(/\r\n/g, "\n");

const WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/seguridad.yml"] as const;

interface Contexto {
  evento: string;
  ref: string;
  perilla: string | undefined;
  /** Lo que dice el job `alcance` (`needs.alcance.outputs.alcance`): «solo-docs», «completo» o vacío (el filtro falló o no corrió). */
  alcance: string;
}

/** Ids de los jobs (claves de dos espacios bajo `jobs:`) con su texto. */
function jobsDe(workflow: string): Map<string, string> {
  const desde = /^jobs:\s*$/m.exec(workflow);
  if (!desde) return new Map();
  const resto = workflow.slice(desde.index + desde[0].length);
  const cabeceras = [...resto.matchAll(/^  ([a-z0-9_-]+):\s*$/gm)];
  const jobs = new Map<string, string>();
  cabeceras.forEach((c, i) => jobs.set(c[1] as string, resto.slice((c.index ?? 0) + c[0].length, cabeceras[i + 1]?.index ?? resto.length)));
  return jobs;
}

/** La condición `if:` del job (sangría de 4, antes de `steps:`/`needs:`…, o la primera de esa sangría). Null si no tiene. */
function condicionDeJob(job: string): string | null {
  const m = /^ {4}if:\s*(.+)$/m.exec(job);
  return m ? (m[1] as string).trim() : null;
}

const SIMBOLOS_PERMITIDOS = /^(?:\s|github\.event_name|github\.ref|vars\.CI_EN_MAIN|needs\.alcance\.outputs\.alcance|cancelled\(\)|always\(\)|'[^'"\\]*'|==|!=|&&|\|\||!|\(|\))+$/;

/**
 * Evalúa la condición de un job para un contexto. Devuelve `"corre"` u `"omitido"`; o un texto de problema si la condición no se puede evaluar con seguridad.
 * `always()` vale verdadero (como en el gate: el resultado de `needs` no cambia si el job se omite por la perilla, que es lo único que se mira acá).
 */
function evaluar(condicion: string, ctx: Contexto): "corre" | "omitido" | { problema: string } {
  const m = /^\$\{\{\s*(.+?)\s*\}\}$/.exec(condicion);
  if (!m) return { problema: `la condición «${condicion}» no está escrita como \${{ … }} (sin las llaves, GitHub la trata como texto)` };
  const cuerpo = m[1] as string;
  if (!SIMBOLOS_PERMITIDOS.test(cuerpo)) return { problema: `la condición «${cuerpo}» usa símbolos fuera de la lista de permitidos` };
  const js = cuerpo
    .replace(/github\.event_name/g, "__e")
    .replace(/github\.ref/g, "__r")
    .replace(/vars\.CI_EN_MAIN/g, "__p")
    .replace(/needs\.alcance\.outputs\.alcance/g, "__a")
    .replace(/cancelled\(\)/g, "false")
    .replace(/always\(\)/g, "true");
  try {
    const f = new Function("__e", "__r", "__p", "__a", `"use strict"; return (${js.replace(/==/g, "===")});`) as (e: string, r: string, p: string, a: string) => unknown;
    return f(ctx.evento, ctx.ref, ctx.perilla ?? "", ctx.alcance) === true ? "corre" : "omitido";
  } catch (e) {
    return { problema: `la condición «${cuerpo}» no se pudo evaluar: ${(e as Error).message}` };
  }
}

const EVENTOS = ["push", "pull_request", "workflow_dispatch", "schedule"];
const REFS = ["refs/heads/main", "refs/heads/ci/algo", "refs/heads/otra", "refs/pull/1/merge"];
const PERILLAS: (string | undefined)[] = [undefined, "", "si", "no", "SI", "true"];
/** Lo que puede decir el filtro de alcance: las dos respuestas, vacío (falló) y cosas raras (todas distintas de «solo-docs» corren todo). */
const ALCANCES = ["solo-docs", "completo", "", "Solo-Docs", "solo-docs "];
/** Los únicos jobs que el filtro de alcance puede omitir (en pull_request con «solo-docs»). */
const JOBS_QUE_SALTA_EL_FILTRO = ["build", "e2e"];

/**
 * El oráculo escrito aparte: se omite en push a main con la perilla distinta de «si»; y los jobs `build` y `e2e` también cuando el filtro dijo EXACTAMENTE «solo-docs» (cualquier otra cosa, o vacío,
 * corre: falla cerrado). Ningún otro job se omite jamás por el filtro.
 */
const debeOmitirse = (c: Contexto, job: string) =>
  (c.evento === "push" && c.ref === "refs/heads/main" && c.perilla !== "si") || (JOBS_QUE_SALTA_EL_FILTRO.includes(job) && c.alcance === "solo-docs");

/** Problemas de un workflow (texto). Lista vacía = bien. */
function problemasDe(archivo: string, workflow: string): string[] {
  const problemas: string[] = [];
  const jobs = jobsDe(workflow);
  if (jobs.size === 0) return [`${archivo}: no se encontró ningún job`];
  if (!/^ {2}workflow_dispatch:/m.test(workflow)) problemas.push(`${archivo}: falta workflow_dispatch (la corrida manual completa)`);
  for (const [id, texto] of jobs) {
    const condicion = condicionDeJob(texto);
    if (condicion === null) {
      problemas.push(`${archivo}: el job ${id} no tiene la condición de la perilla CI_EN_MAIN`);
      continue;
    }
    if (!/vars\.CI_EN_MAIN/.test(condicion)) problemas.push(`${archivo}: el job ${id} tiene una condición que no usa la perilla CI_EN_MAIN`);
    for (const evento of EVENTOS) {
      for (const ref of REFS) {
        for (const perilla of PERILLAS) {
          for (const alcance of ALCANCES) {
            const ctx = { evento, ref, perilla, alcance };
            const r = evaluar(condicion, ctx);
            if (typeof r === "object") {
              problemas.push(`${archivo}: el job ${id}: ${r.problema}`);
              return problemas;
            }
            const esperado = debeOmitirse(ctx, id) ? "omitido" : "corre";
            if (r !== esperado) problemas.push(`${archivo}: el job ${id} con ${evento} en ${ref}, perilla ${JSON.stringify(perilla)} y alcance ${JSON.stringify(alcance)} da «${r}» y tendría que dar «${esperado}»`);
          }
        }
      }
    }
  }
  return problemas;
}

describe("CI: la perilla CI_EN_MAIN (workflows reales)", () => {
  for (const archivo of WORKFLOWS) {
    it(`${archivo}: cada job tiene la condición y no omite nada fuera de «push a main con la perilla apagada»`, () => {
      expect(problemasDe(archivo, leer(archivo))).toEqual([]);
    });
  }

  it("ci.yml tiene los seis jobs esperados con la perilla (alcance, estatico, build, integracion, e2e, gate) y seguridad.yml los suyos", () => {
    expect([...jobsDe(leer(WORKFLOWS[0])).keys()]).toEqual(["alcance", "estatico", "build", "integracion", "e2e", "gate"]);
    expect([...jobsDe(leer(WORKFLOWS[1])).keys()]).toEqual(["dependencias", "pruebas-de-seguridad", "zap"]);
  });

  it("codeql.yml y gitleaks.yml no llevan la perilla (siguen corriendo en main)", () => {
    for (const archivo of [".github/workflows/codeql.yml", ".github/workflows/gitleaks.yml"]) expect(leer(archivo)).not.toMatch(/CI_EN_MAIN/);
  });
});

describe("CI: la perilla CI_EN_MAIN (violaciones inyectadas, tienen que ponerse rojas)", () => {
  const ci = leer(".github/workflows/ci.yml");
  const SANA = "if: ${{ !(github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.CI_EN_MAIN != 'si') }}";
  const GATE = "if: ${{ always() && !(github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.CI_EN_MAIN != 'si') }}";

  it("el texto sano existe en el ci.yml real (si no, las inyecciones de abajo no prueban nada)", () => {
    expect(ci).toContain(`    ${SANA}`);
    expect(ci).toContain(`    ${GATE}`);
  });

  const casos: { titulo: string; de: string; a: string }[] = [
    { titulo: "un job sin la condición", de: `    ${SANA}\n`, a: "" },
    { titulo: "se quita la mitad `push` (omitiría también un pull_request a main... y una corrida manual en main)", de: "github.event_name == 'push' && ", a: "" },
    { titulo: "se quita la mitad `main` (omitiría todo push, también los de ci/**)", de: " && github.ref == 'refs/heads/main'", a: "" },
    { titulo: "`&&` cambiado por `||` entre push y main", de: "github.event_name == 'push' && github.ref", a: "github.event_name == 'push' || github.ref" },
    { titulo: "otra variable en lugar de la perilla", de: "vars.CI_EN_MAIN != 'si'", a: "vars.OTRA != 'si'" },
    { titulo: "la perilla invertida (apagada = corre)", de: "vars.CI_EN_MAIN != 'si'", a: "vars.CI_EN_MAIN == 'si'" },
    { titulo: "el gate en `always()` a secas (pero entonces falla en main con la perilla apagada: no está permitido sin la perilla)", de: GATE, a: "if: always()" },
    { titulo: "un símbolo fuera de la lista de permitidos (`github.actor`)", de: "github.event_name == 'push' &&", a: "github.actor == 'bot' &&" },
    { titulo: "build deja de saltarse con «solo-docs» (se quita la mitad del filtro)", de: " && needs.alcance.outputs.alcance != 'solo-docs'", a: "" },
    { titulo: "el filtro invertido (se salta con «completo»)", de: "needs.alcance.outputs.alcance != 'solo-docs'", a: "needs.alcance.outputs.alcance != 'completo'" },
    { titulo: "el filtro con `==` (se salta todo salvo «solo-docs»)", de: "needs.alcance.outputs.alcance != 'solo-docs'", a: "needs.alcance.outputs.alcance == 'solo-docs'" },
    { titulo: "la condición sin las llaves de GitHub", de: SANA, a: "if: !(github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.CI_EN_MAIN != 'si')" },
  ];

  for (const c of casos) {
    it(`pone rojo: ${c.titulo}`, () => {
      // Se aplica solo a la primera aparición (un job), que alcanza para que el guardián lo vea.
      const mal = ci.replace(c.de, c.a);
      expect(mal).not.toBe(ci);
      expect(problemasDe(".github/workflows/ci.yml", mal).length).toBeGreaterThan(0);
    });
  }
});
