import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * GT-21 y GT-23 (tanda T14 del plan de endurecimiento de seguridad; fila O.99b de `docs/pureza-integracion.md`), en MODO «INFORME». Son los dos guards cuya medida correcta exige tocar archivos
 * que la rama no puede tocar sin autorización expresa del dueño (`vercel.json`, `plataforma/vercel.json`, `.github/`): las acciones externas E.4, E.5 y E.7 del plan. Por eso este test LEE esos
 * archivos y REPORTA su estado, sin tocarlos ni fallar por lo que todavía no se hizo:
 *
 *  - **GT-21, despliegues frenados** (S-37, S-38): la raíz con `git.deploymentEnabled: false` (una rama de Dependabot o de un tercero no se despliega con los secretos reales) y la consola
 *    (`plataforma/vercel.json`) SIN `ignoreCommand: "exit 1"` (en Vercel, un `ignoreCommand` que sale con 1 significa «construí»: la consola se construye y despliega en cada push).
 *  - **GT-23, cadena de suministro** (S-39): las actions de `ci.yml` fijadas por SHA de 40 caracteres (no por etiqueta movible como `@v4`), el ecosistema `github-actions` en Dependabot, y
 *    `npm run auditar:dependencias` dentro del Gate de `ci.yml`.
 *
 * Qué SÍ hace en modo informe (bloqueante):
 *  1. Los evaluadores son correctos (casos sintéticos con y sin cumplimiento, con LF y con CRLF): cuando se autoricen E.4/E.5/E.7 y se hagan los cambios, medirán bien.
 *  2. El informe lista EXACTAMENTE los cinco puntos (dos de GT-21 y tres de GT-23) y cada uno dice si cumple y qué acción externa lo cierra (nada se mide en silencio).
 *  3. «No empeora»: los puntos que HOY cumplen (`YA_CUMPLEN`) siguen cumpliendo. Hoy: el freno de despliegues de la raíz y el de la consola (E.5, hecho: construye solo `main`, y un test ejecuta el comando real).
 *  4. Imprime la tabla del estado real (`console.info`), para que quien corre el test vea qué falta.
 *
 * Para pasar a modo estricto (los cinco puntos bloqueantes) cuando las acciones externas estén hechas: cambiar `MODO` a `"estricto"`. No hace falta tocar nada más.
 *
 * Mutaciones: los casos sintéticos con una action por etiqueta, sin el ecosistema, con el Gate sin la auditoría, y con `vercel.json` sin `git.deploymentEnabled: false` ponen rojo la medida. La
 * mutación sobre el archivo REAL (sacar `deploymentEnabled` de `vercel.json`, que dispararía «no empeora») NO se midió: `vercel.json` y `.github/` no se tocan sin autorización, ni siquiera para
 * probar; el mismo evaluador sí se probó con esa entrada.
 */
const RAIZ = join(__dirname, "../..");
const MODO = "informe" as "informe" | "estricto";

interface Punto {
  id: string;
  gt: "GT-21" | "GT-23";
  descripcion: string;
  cumple: boolean;
  /** Qué hay que hacer (y quién lo autoriza) para que cumpla. */
  accion: string;
}

const lf = (s: string) => s.replace(/\r\n/g, "\n");

/** GT-21. Recibe el texto de los dos JSON. Un JSON roto o ausente NO cumple (falla cerrado). */
export function evaluarDespliegues(vercelRaiz: string | null, vercelConsola: string | null): Punto[] {
  const leer = (t: string | null): Record<string, unknown> | null => {
    try {
      return t === null ? null : (JSON.parse(lf(t)) as Record<string, unknown>);
    } catch {
      return null;
    }
  };
  const raiz = leer(vercelRaiz);
  const consola = leer(vercelConsola);
  const git = (raiz?.git ?? {}) as { deploymentEnabled?: unknown };
  return [
    {
      id: "raiz-sin-despliegue-por-git",
      gt: "GT-21",
      descripcion: "`vercel.json` de la raíz con `git.deploymentEnabled: false` (ninguna rama se despliega sola)",
      cumple: git.deploymentEnabled === false,
      accion: "E.4 (S-37): fusionar a `main` el freno de `vercel.json`, o `target-branch` en Dependabot. Toca `vercel.json`: autorización expresa del dueño.",
    },
    {
      id: "consola-sin-ignoreCommand-exit-1",
      gt: "GT-21",
      descripcion: "`plataforma/vercel.json` SIN `ignoreCommand: \"exit 1\"` (que construye y despliega la consola en cada push)",
      cumple: consola !== null && consola.ignoreCommand !== "exit 1",
      accion: "E.5 (S-38): `ignoreCommand` que solo deje pasar `VERCEL_ENV=production`, o `git.deploymentEnabled: false`. Toca `plataforma/vercel.json`: autorización expresa del dueño.",
    },
  ];
}

/** GT-23. Recibe el texto de `ci.yml`, de `dependabot.yml` y de `package.json`. */
export function evaluarCadenaDeSuministro(ci: string | null, dependabot: string | null, paquete: string | null): Punto[] {
  const yml = lf(ci ?? "");
  const usos = [...yml.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]!);
  const sinFijar = usos.filter((u) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(u));
  let scriptAuditar = false;
  try {
    scriptAuditar = typeof (JSON.parse(lf(paquete ?? "{}")) as { scripts?: Record<string, string> }).scripts?.["auditar:dependencias"] === "string";
  } catch {
    scriptAuditar = false;
  }
  return [
    {
      id: "actions-por-sha",
      gt: "GT-23",
      descripcion: `las actions de \`ci.yml\` fijadas por SHA de 40 caracteres (hoy sin fijar: ${sinFijar.length} de ${usos.length}${sinFijar.length ? `, p. ej. ${sinFijar[0]}` : ""})`,
      cumple: usos.length > 0 && sinFijar.length === 0,
      accion: "E.7 (S-39): fijar cada `uses:` por SHA. Toca `.github/`: autorización expresa del dueño.",
    },
    {
      id: "dependabot-github-actions",
      gt: "GT-23",
      descripcion: "`dependabot.yml` con el ecosistema `github-actions`",
      cumple: /package-ecosystem:\s*["']?github-actions["']?/.test(lf(dependabot ?? "")),
      accion: "E.7 (S-39): sumar el ecosistema `github-actions` a Dependabot. Toca `.github/`: autorización expresa del dueño.",
    },
    {
      id: "auditar-dependencias-en-el-gate",
      gt: "GT-23",
      descripcion: "`npm run auditar:dependencias` dentro del Gate de `ci.yml` (el script ya existe en `package.json`)",
      cumple: scriptAuditar && /npm run auditar:dependencias/.test(yml),
      accion: "E.7 (S-39): sumar el paso al Gate. Toca `.github/`: autorización expresa del dueño.",
    },
  ];
}

const leerONulo = (ruta: string): string | null => {
  try {
    return readFileSync(join(RAIZ, ruta), "utf8");
  } catch {
    return null;
  }
};

/** Los puntos (de cinco) que hoy cumplen; el resto es lo pendiente de E.4, E.5 y E.7. Solo se agrega a medida que se cierran; nunca se saca. */
const YA_CUMPLEN = ["raiz-sin-despliegue-por-git", "consola-sin-ignoreCommand-exit-1"];

const IDS = ["raiz-sin-despliegue-por-git", "consola-sin-ignoreCommand-exit-1", "actions-por-sha", "dependabot-github-actions", "auditar-dependencias-en-el-gate"];

function informeReal(): Punto[] {
  return [
    ...evaluarDespliegues(leerONulo("vercel.json"), leerONulo("plataforma/vercel.json")),
    ...evaluarCadenaDeSuministro(leerONulo(".github/workflows/ci.yml"), leerONulo(".github/dependabot.yml"), leerONulo("package.json")),
  ];
}

describe("GT-21 y GT-23 — despliegues frenados y cadena de suministro (modo informe)", () => {
  it("los evaluadores miden bien (casos sintéticos, con LF y con CRLF)", () => {
    const bien = evaluarDespliegues('{ "git": { "deploymentEnabled": false } }', '{ "regions": ["pdx1"] }');
    expect(bien.map((p) => p.cumple)).toEqual([true, true]);
    const mal = evaluarDespliegues('{ "regions": ["pdx1"] }', '{ "ignoreCommand": "exit 1" }');
    expect(mal.map((p) => p.cumple)).toEqual([false, false]);
    expect(evaluarDespliegues('{ "git": { "deploymentEnabled": true } }', "{ no es json").map((p) => p.cumple)).toEqual([false, false]);
    expect(evaluarDespliegues(null, null).map((p) => p.cumple)).toEqual([false, false]);
    expect(evaluarDespliegues('{ "git": {\r\n "deploymentEnabled": false } }', '{ "ignoreCommand": "[ \\"$VERCEL_ENV\\" = production ]" }').map((p) => p.cumple)).toEqual([true, true]);

    const sha = "a".repeat(40);
    const ciBien = `steps:\n  - uses: actions/checkout@${sha}\n  - uses: actions/setup-node@${sha}\n  - run: npm run auditar:dependencias\n`;
    const deps = '{ "scripts": { "auditar:dependencias": "tsx x.ts" } }';
    expect(evaluarCadenaDeSuministro(ciBien, 'updates:\n  - package-ecosystem: "github-actions"\n', deps).map((p) => p.cumple)).toEqual([true, true, true]);
    expect(evaluarCadenaDeSuministro(ciBien.replace(/\n/g, "\r\n"), 'updates:\r\n  - package-ecosystem: "github-actions"\r\n', deps).map((p) => p.cumple)).toEqual([true, true, true]);
    // la mutación: una action por etiqueta, sin el ecosistema, con el Gate sin la auditoría
    const ciMal = ciBien.replace(`actions/checkout@${sha}`, "actions/checkout@v4").replace("  - run: npm run auditar:dependencias\n", "");
    expect(evaluarCadenaDeSuministro(ciMal, 'updates:\n  - package-ecosystem: "npm"\n', deps).map((p) => p.cumple)).toEqual([false, false, false]);
    // sin ninguna action no se da por cumplido (falla cerrado), y sin el script en package.json el paso no alcanza
    expect(evaluarCadenaDeSuministro("jobs: {}\n", "", "{}").map((p) => p.cumple)).toEqual([false, false, false]);
    expect(evaluarCadenaDeSuministro(ciBien, "", "{}")[2]!.cumple).toBe(false);
  });

  it("E.5: el `ignoreCommand` REAL de la consola construye solo `main` (código 1 = construir; 0 = saltear)", () => {
    const consola = JSON.parse(lf(leerONulo("plataforma/vercel.json") ?? "{}")) as { ignoreCommand?: unknown };
    expect(typeof consola.ignoreCommand, "plataforma/vercel.json sin ignoreCommand").toBe("string");
    const comando = consola.ignoreCommand as string;
    const codigoPara = (rama: string | undefined): number | null => {
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.VERCEL_GIT_COMMIT_REF;
      if (rama !== undefined) env.VERCEL_GIT_COMMIT_REF = rama;
      return spawnSync("sh", ["-c", comando], { env, encoding: "utf8" }).status;
    };
    expect(codigoPara("main"), "main tiene que construirse").toBe(1);
    for (const rama of ["dependabot/npm_and_yarn/next-16.9.9", "ccr-a76a466b-ribsp8", "hoja-de-ruta-fases-5-6-etapa-a", "main-vieja-57-migraciones", "mainx", "feature/main"]) {
      expect(codigoPara(rama), `${rama} no tiene que construirse`).toBe(0);
    }
    // sin la variable (build que no viene de Git) falla cerrado: se saltea
    expect(codigoPara(undefined)).toBe(0);
  });

  it("el informe real lista exactamente los puntos, cada uno con su descripción y la acción externa que lo cierra", () => {
    const informe = informeReal();
    expect(informe.map((p) => p.id)).toEqual(IDS);
    for (const p of informe) {
      expect(p.descripcion.length, p.id).toBeGreaterThan(20);
      expect(p.accion, p.id).toMatch(/^E\.[457] \(S-3[789]\)/);
    }
  });

  it("no empeora: los puntos que hoy cumplen siguen cumpliendo", () => {
    const informe = informeReal();
    for (const id of YA_CUMPLEN) expect(informe.find((p) => p.id === id)?.cumple, `${id}: dejó de cumplir`).toBe(true);
  });

  it("imprime el estado real; en modo estricto, los cinco puntos tienen que cumplir", () => {
    const informe = informeReal();
    const pendientes = informe.filter((p) => !p.cumple);
    console.info(
      [`GT-21/GT-23 (${MODO}): ${informe.length - pendientes.length} de ${informe.length} puntos cumplen.`, ...pendientes.map((p) => `  PENDIENTE [${p.gt}] ${p.descripcion}\n    -> ${p.accion}`)].join("\n"),
    );
    if (MODO === "estricto") expect(pendientes.map((p) => p.id)).toEqual([]);
  });
});
