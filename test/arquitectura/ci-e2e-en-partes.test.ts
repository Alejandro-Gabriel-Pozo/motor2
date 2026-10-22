import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluarConteo, type ParteDeResultado, type ResultadoPlaywright } from "../../scripts/conteo-e2e-reparto";

/**
 * El E2E de la CI corre repartido en partes (`playwright test --shard=i/n`, una matriz de jobs; el job `conteo-e2e` junta los resultados). Este guardián cuida las dos mitades de ese reparto:
 *
 *  1. EL WORKFLOW (`.github/workflows/ci.yml`, leído como texto, igual que los demás guardianes de la CI): la matriz `parte` del job `e2e` es 1…n correlativa y n coincide con `PARTES_E2E` (la cantidad que
 *     exige `conteo-e2e`); el reparto usa `--shard=${{ matrix.parte }}/${{ strategy.job-total }}`; `fail-fast: false` (una parte roja no cancela a las demás: se ven todos los rojos de una vez); cada parte sube
 *     artefactos con NOMBRE ÚNICO (`…-${{ matrix.parte }}`); `conteo-e2e` espera al `e2e`, corre siempre y llama al script del conteo; y el `Gate (requerido)` espera a TODOS los jobs y los exige en verde uno por uno.
 *  2. EL CONTEO (`scripts/conteo-e2e-reparto.ts`, con JSON sintéticos con la forma real del reporter de Playwright): una parte de menos o de más, un spec en dos partes, un spec o una prueba sin correr, una prueba
 *     repetida, cuentas que no cierran con el árbol del resultado y una prueba fallada ponen rojo el conteo; el reparto correcto da cero errores y la misma huella sea cual sea el orden en que llegan las partes.
 *
 * Mutaciones demostradas (sobre el texto real de ci.yml y sobre los JSON): n distinto entre la matriz y `PARTES_E2E`; sacar `fail-fast: false`; sacar el `--shard`; el mismo nombre de artefacto en todas las
 * partes; sacar `conteo-e2e` del `needs` del Gate o su comprobación en `success`; `conteo-e2e` sin `if: always()`; y cada chequeo del conteo con su caso (ver los `it`).
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8").replace(/\r\n/g, "\n");

/** Texto de un job: desde `  <job>:` hasta el siguiente job (misma sangría) o el final. */
function trozoDeJob(workflow: string, job: string): string {
  const inicio = new RegExp(`^  ${job}:\\s*$`, "m").exec(workflow);
  if (!inicio) return "";
  const resto = workflow.slice(inicio.index + inicio[0].length);
  const siguiente = /^  [a-z0-9-]+:\s*$/m.exec(resto);
  return siguiente ? resto.slice(0, siguiente.index) : resto;
}

/** Ids de todos los jobs del workflow (las claves de dos espacios bajo `jobs:`). */
function idsDeLosJobs(workflow: string): string[] {
  const desdeJobs = workflow.slice(workflow.search(/^jobs:\s*$/m));
  return [...desdeJobs.matchAll(/^  ([a-z0-9-]+):\s*$/gm)].map((m) => m[1]!);
}

/** Problemas del reparto del E2E en un `ci.yml` (texto). Lista vacía = bien. */
function problemasDelWorkflow(workflow: string): string[] {
  const p: string[] = [];
  const e2e = trozoDeJob(workflow, "e2e");
  const conteo = trozoDeJob(workflow, "conteo-e2e");
  const gate = trozoDeJob(workflow, "gate");
  if (!e2e) return ["no se encontró el job e2e"];

  const partes = /^\s+PARTES_E2E:\s*"?(\d+)"?\s*$/m.exec(workflow)?.[1];
  if (!partes) p.push("falta PARTES_E2E en el env del workflow");
  const lista = /^\s+parte:\s*\[([^\]]*)\]\s*$/m.exec(e2e)?.[1];
  const matriz = lista ? lista.split(",").map((x) => Number(x.trim())) : [];
  if (!lista) p.push("el job e2e no tiene una lista `matrix.parte`");
  else if (matriz.some((n, i) => n !== i + 1)) p.push(`la lista matrix.parte del job e2e no es 1…n correlativa: [${lista}]`);
  if (partes && lista && matriz.length !== Number(partes)) p.push(`la matriz del job e2e tiene ${matriz.length} partes y PARTES_E2E dice ${partes}`);
  if (matriz.length < 2) p.push("el E2E tiene que repartirse en 2 partes o más");

  if (!/^\s+fail-fast:\s*false\s*$/m.test(e2e)) p.push("el job e2e no tiene `fail-fast: false`");
  if (!/test "\$\{\{ strategy\.job-total \}\}" = "\$PARTES_E2E"/.test(e2e)) p.push('falta el paso de control `test "${{ strategy.job-total }}" = "$PARTES_E2E"` en el job e2e');
  if (!/run: npm run test:e2e -- --shard=\$\{\{ matrix\.parte \}\}\/\$\{\{ strategy\.job-total \}\}\s*$/m.test(e2e)) p.push("el job e2e no corre `npm run test:e2e -- --shard=${{ matrix.parte }}/${{ strategy.job-total }}`");
  // Un `playwright test` suelto (sin --shard) en el job correría la suite entera en cada parte.
  const corridas = [...e2e.matchAll(/^\s+run: (?:npm run test:e2e|npx playwright test)\b.*$/gm)].map((m) => m[0]);
  if (corridas.length !== 1) p.push(`el job e2e tiene que correr Playwright UNA vez (con --shard); corre ${corridas.length}`);

  const artefactos = [...e2e.matchAll(/uses: actions\/upload-artifact@\S+[^\n]*\n\s+with:\n\s+name: ([^\n]+)/g)].map((m) => m[1]!.trim());
  if (artefactos.length < 2) p.push("el job e2e no sube sus artefactos (resultado y trazas)");
  for (const nombre of artefactos) if (!nombre.includes("${{ matrix.parte }}")) p.push(`el artefacto «${nombre}» del job e2e no lleva \${{ matrix.parte }} en el nombre: las partes se pisarían`);
  if (!/resultado-playwright-\$\{\{ matrix\.parte \}\}/.test(e2e)) p.push("el resultado de cada parte no se sube como `resultado-playwright-${{ matrix.parte }}` (lo descarga conteo-e2e)");

  if (!conteo) p.push("falta el job conteo-e2e");
  else {
    if (!/^    needs: \[e2e\]\s*$/m.test(conteo)) p.push("conteo-e2e no espera al job e2e (`needs: [e2e]`)");
    if (!/^    if: always\(\)\s*$/m.test(conteo)) p.push("conteo-e2e no corre siempre (`if: always()`): con un e2e rojo el Gate vería un conteo omitido en vez de rojo");
    if (!/pattern: resultado-playwright-\*/.test(conteo)) p.push("conteo-e2e no descarga los `resultado-playwright-*`");
    if (!/playwright test --list --reporter=json/.test(conteo)) p.push("conteo-e2e no lista los specs de la suite entera con `playwright test --list --reporter=json`");
    if (!/npx tsx scripts\/conteo-e2e\.ts \S+ \S+ "\$PARTES_E2E"\s*$/m.test(conteo)) p.push('conteo-e2e no corre scripts/conteo-e2e.ts con la cantidad de partes ("$PARTES_E2E")');
  }

  // El Gate: espera a todos los jobs (menos él) y exige cada uno en `success`.
  const necesita = /^    needs: \[([^\]]*)\]\s*$/m.exec(gate)?.[1]?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
  const todos = idsDeLosJobs(workflow).filter((id) => id !== "gate");
  for (const id of todos) {
    if (!necesita.includes(id)) p.push(`el Gate no espera al job ${id} (needs)`);
    if (!new RegExp(`test .*"\\$\\{\\{ needs\\.${id}\\.result \\}\\}" = "success"`).test(gate)) p.push(`el Gate no exige ${id} en success`);
  }
  if (!/^    if: always\(\)\s*$/m.test(gate)) p.push("el Gate no corre siempre (`if: always()`): un job rojo lo dejaría omitido");
  if (!/^    name: Gate \(requerido\)\s*$/m.test(gate)) p.push("el job gate ya no se llama «Gate (requerido)»: la regla de la rama dejaría de encontrarlo");
  if (/\$\{\{\s*secrets\./.test(workflow)) p.push("el workflow usa secrets.*");
  return p;
}

describe("CI: el E2E repartido en partes (workflow)", () => {
  const real = leer(".github/workflows/ci.yml");

  it("el ci.yml real cumple todo (cero problemas)", () => {
    expect(problemasDelWorkflow(real)).toEqual([]);
  });

  it("el E2E tiene más de una parte y los jobs del workflow son los esperados (el Gate cubre a todos)", () => {
    expect(idsDeLosJobs(real).sort()).toEqual(["build", "conteo", "conteo-e2e", "e2e", "estatico", "gate", "integracion"]);
  });

  it("la premisa del reparto: playwright.config.ts reparte por ARCHIVO (fullyParallel falso) y corre un worker por parte", () => {
    const config = leer("playwright.config.ts");
    expect(/^\s+fullyParallel:\s*false,/m.test(config), "fullyParallel").toBe(true);
    expect(/^\s+workers:\s*1,/m.test(config), "workers").toBe(true);
  });

  describe("mutaciones sobre el texto real", () => {
    const muta = (de: string | RegExp, a: string) => {
      const mutado = real.replace(de, a);
      expect(mutado, "la mutación no cambió nada: el patrón no encontró el texto").not.toBe(real);
      return problemasDelWorkflow(mutado);
    };

    // N sale del ci.yml real: cambiar la cantidad de partes (una sola línea de PARTES_E2E y la lista de la matriz) no obliga a tocar estos casos.
    const N = Number(/^\s+PARTES_E2E:\s*"(\d+)"/m.exec(real)?.[1]);
    const lista = (n: number) => `[${Array.from({ length: n }, (_, i) => i + 1).join(", ")}]`;
    const mutaMatriz = (nueva: string) => {
      const mutado = real.replace(/(  e2e:[\s\S]*?parte: )\[[^\]]*\]/, `$1${nueva}`);
      expect(mutado, "la mutación no cambió nada").not.toBe(real);
      return problemasDelWorkflow(mutado);
    };

    it("la cantidad de partes del ci.yml real es de 2 o más y la matriz la repite", () => {
      expect(N).toBeGreaterThanOrEqual(2);
      expect(real).toContain(`parte: ${lista(N)}`);
    });
    it("PARTES_E2E distinto de la cantidad de partes de la matriz", () => {
      expect(muta(/(PARTES_E2E: )"\d+"/, `$1"${N - 1}"`)).toContain(`la matriz del job e2e tiene ${N} partes y PARTES_E2E dice ${N - 1}`);
    });
    it("una parte de más en la matriz sin tocar PARTES_E2E", () => {
      expect(mutaMatriz(lista(N + 1))).toContain(`la matriz del job e2e tiene ${N + 1} partes y PARTES_E2E dice ${N}`);
    });
    it("una matriz con un hueco (la parte 2 nunca corre)", () => {
      expect(mutaMatriz(`[1, ${Array.from({ length: N - 1 }, (_, i) => i + 3).join(", ")}]`)[0]).toMatch(/no es 1…n correlativa/);
    });
    it("sin `fail-fast: false` en el e2e", () => {
      const mutado = real.replace(/(  e2e:[\s\S]*?)      fail-fast: false\n/, "$1");
      expect(mutado).not.toBe(real);
      expect(problemasDelWorkflow(mutado)).toContain("el job e2e no tiene `fail-fast: false`");
    });
    it("sin el paso de control de la cantidad de partes", () => {
      const mutado = real.replace(/      - name: Control de la cantidad de partes\n        run: test "\$\{\{ strategy\.job-total \}\}" = "\$PARTES_E2E"\n/, "");
      expect(mutado).not.toBe(real);
      expect(problemasDelWorkflow(mutado)).toContain('falta el paso de control `test "${{ strategy.job-total }}" = "$PARTES_E2E"` en el job e2e');
    });
    it("Playwright sin --shard (cada parte correría la suite entera)", () => {
      expect(muta(/npm run test:e2e -- --shard=\$\{\{ matrix\.parte \}\}\/\$\{\{ strategy\.job-total \}\}/, "npm run test:e2e")).toContain("el job e2e no corre `npm run test:e2e -- --shard=${{ matrix.parte }}/${{ strategy.job-total }}`");
    });
    it("el --shard con otra cantidad que la de la matriz", () => {
      expect(muta(/(test:e2e -- --shard=\$\{\{ matrix\.parte \}\})\/\$\{\{ strategy\.job-total \}\}/, "$1/4")).toContain("el job e2e no corre `npm run test:e2e -- --shard=${{ matrix.parte }}/${{ strategy.job-total }}`");
    });
    it("un segundo Playwright suelto en el job", () => {
      expect(muta(/(      - name: npm run test:e2e\n        run: npm run test:e2e -- --shard=\$\{\{ matrix\.parte \}\}\/\$\{\{ strategy\.job-total \}\}\n)/, "$1      - name: otra\n        run: npx playwright test\n")).toContain("el job e2e tiene que correr Playwright UNA vez (con --shard); corre 2");
    });
    it("el mismo nombre de artefacto en todas las partes (se pisarían)", () => {
      expect(muta(/name: playwright-test-results-\$\{\{ matrix\.parte \}\}/, "name: playwright-test-results")).toContain("el artefacto «playwright-test-results» del job e2e no lleva ${{ matrix.parte }} en el nombre: las partes se pisarían");
    });
    it("el resultado de la parte con otro nombre que el que descarga conteo-e2e", () => {
      expect(muta(/name: resultado-playwright-\$\{\{ matrix\.parte \}\}/, "name: resultado-${{ matrix.parte }}")).toContain("el resultado de cada parte no se sube como `resultado-playwright-${{ matrix.parte }}` (lo descarga conteo-e2e)");
    });
    it("conteo-e2e sin `if: always()`", () => {
      const mutado = real.replace(/(  conteo-e2e:[\s\S]*?)    if: always\(\)\n/, "$1");
      expect(mutado).not.toBe(real);
      expect(problemasDelWorkflow(mutado)).toContain("conteo-e2e no corre siempre (`if: always()`): con un e2e rojo el Gate vería un conteo omitido en vez de rojo");
    });
    it("conteo-e2e sin correr el script", () => {
      expect(muta(/npx tsx scripts\/conteo-e2e\.ts /, "echo ")).toContain('conteo-e2e no corre scripts/conteo-e2e.ts con la cantidad de partes ("$PARTES_E2E")');
    });
    it("conteo-e2e sin pasarle la cantidad de partes al script (contaría contra cualquier cosa)", () => {
      expect(muta(/(conteo-e2e\.ts partes-e2e lista-playwright\.json) "\$PARTES_E2E"/, "$1")).toContain('conteo-e2e no corre scripts/conteo-e2e.ts con la cantidad de partes ("$PARTES_E2E")');
    });
    it("el job conteo-e2e borrado", () => {
      const mutado = real.replace(/  conteo-e2e:[\s\S]*?(?=  gate:)/, "");
      expect(mutado).not.toBe(real);
      const problemas = problemasDelWorkflow(mutado);
      expect(problemas).toContain("falta el job conteo-e2e");
    });
    it("el Gate sin esperar a conteo-e2e", () => {
      expect(muta(/needs: \[estatico, build, integracion, conteo, e2e, conteo-e2e\]/, "needs: [estatico, build, integracion, conteo, e2e]")).toContain("el Gate no espera al job conteo-e2e (needs)");
    });
    it("el Gate sin exigir e2e en success", () => {
      expect(muta(/ -a "\$\{\{ needs\.e2e\.result \}\}" = "success"/, "")).toContain("el Gate no exige e2e en success");
    });
    it("el Gate sin exigir conteo-e2e en success", () => {
      expect(muta(/ -a "\$\{\{ needs\.conteo-e2e\.result \}\}" = "success"/, "")).toContain("el Gate no exige conteo-e2e en success");
    });
    it("el Gate renombrado", () => {
      expect(muta(/name: Gate \(requerido\)/, "name: Gate")).toContain("el job gate ya no se llama «Gate (requerido)»: la regla de la rama dejaría de encontrarlo");
    });
  });
});

// ---- El conteo, con JSON sintéticos con la forma real del reporter de Playwright ----

type Prueba = { titulo: string; linea: number; estado?: string };
/** Un archivo de spec como lo arma el reporter JSON: una suite titulada como el archivo, con sus specs y una prueba por spec. */
const archivo = (nombre: string, pruebas: Prueba[]) => ({
  title: nombre,
  file: nombre,
  specs: pruebas.map((t) => ({ title: t.titulo, file: nombre, line: t.linea, tests: [{ status: t.estado ?? "expected" }] })),
  suites: [],
});
const resultado = (archivos: ReturnType<typeof archivo>[], duracionMs = 60_000): ResultadoPlaywright => {
  const estados = archivos.flatMap((a) => a.specs.map((s) => s.tests[0]!.status));
  const n = (e: string) => estados.filter((x) => x === e).length;
  return { stats: { expected: n("expected"), unexpected: n("unexpected"), flaky: n("flaky"), skipped: n("skipped"), duration: duracionMs }, suites: archivos };
};

const A = archivo("a.spec.ts", [
  { titulo: "uno", linea: 5 },
  { titulo: "dos", linea: 9 },
]);
const B = archivo("b.spec.ts", [{ titulo: "tres", linea: 4 }]);
const C = archivo("c.spec.ts", [
  { titulo: "cuatro", linea: 3 },
  { titulo: "cinco", linea: 8, estado: "skipped" },
]);
const parte = (nombre: string, archivos: ReturnType<typeof archivo>[]): ParteDeResultado => ({ nombre, json: resultado(archivos) });
const LISTA = resultado([A, B, C]);
const BIEN: ParteDeResultado[] = [parte("p1", [A]), parte("p2", [B, C])];

describe("CI: el conteo de las partes del E2E (scripts/conteo-e2e-reparto.ts)", () => {
  it("un reparto correcto: cero errores, suma las cuentas y la tabla trae todas las partes", () => {
    const { errores, texto } = evaluarConteo({ partes: BIEN, lista: LISTA, esperadas: 2 });
    expect(errores).toEqual([]);
    expect(texto).toContain("- total (suma de las partes): 5");
    expect(texto).toContain("- pasados: 4");
    expect(texto).toContain("- salteados: 1");
    expect(texto).toContain("- flaky (pasaron en el reintento): 0");
    expect(texto).toContain("- fallados: 0");
    expect(texto).toContain("| p1 | 1 | 2 |");
    expect(texto).toContain("| p2 | 2 | 3 |");
  });

  it("la huella no depende del orden en que llegan las partes ni de cómo se repartieron los specs", () => {
    const huella = (t: string) => /: ([0-9a-f]{64})$/m.exec(t)?.[1];
    const a = huella(evaluarConteo({ partes: BIEN, lista: LISTA, esperadas: 2 }).texto);
    const b = huella(evaluarConteo({ partes: [...BIEN].reverse(), lista: LISTA, esperadas: 2 }).texto);
    const c = huella(evaluarConteo({ partes: [parte("x", [A, B]), parte("y", [C])], lista: LISTA, esperadas: 2 }).texto);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("un cambio de estado SÍ cambia la huella (la comparación con una corrida de un solo runner es útil)", () => {
    const huella = (t: string) => /: ([0-9a-f]{64})$/m.exec(t)?.[1];
    const base = huella(evaluarConteo({ partes: BIEN, lista: LISTA, esperadas: 2 }).texto);
    const flaky = archivo("b.spec.ts", [{ titulo: "tres", linea: 4, estado: "flaky" }]);
    expect(huella(evaluarConteo({ partes: [parte("p1", [A]), parte("p2", [flaky, C])], lista: LISTA, esperadas: 2 }).texto)).not.toBe(base);
  });

  it("una parte vacía (hay más partes que bloques de specs) no es un error, pero se avisa", () => {
    const { errores, texto } = evaluarConteo({ partes: [...BIEN, parte("p3", [])], lista: LISTA, esperadas: 3 });
    expect(errores).toEqual([]);
    expect(texto).toContain("- aviso: 1 partes no corrieron ningún spec (p3)");
    expect(evaluarConteo({ partes: BIEN, lista: LISTA, esperadas: 2 }).texto).not.toContain("aviso");
  });

  it("MUTACIÓN: una parte menos de las esperadas (un job no subió su resultado)", () => {
    const { errores } = evaluarConteo({ partes: [BIEN[0]!], lista: LISTA, esperadas: 2 });
    expect(errores.join("\n")).toMatch(/Hay 1 resultados de Playwright y tendría que haber exactamente 2/);
    expect(errores.join("\n")).toMatch(/Faltan 1 specs de `playwright test --list` que ninguna parte corrió: b\.spec\.ts, c\.spec\.ts|Faltan 2 specs/);
  });

  it("MUTACIÓN: una parte de más (la matriz creció y PARTES_E2E no)", () => {
    const { errores } = evaluarConteo({ partes: [...BIEN, parte("p3", [])], lista: LISTA, esperadas: 2 });
    expect(errores.join("\n")).toMatch(/Hay 3 resultados de Playwright y tendría que haber exactamente 2/);
  });

  it("MUTACIÓN: un spec en dos partes (reparto que parte un archivo, o dos partes que corren lo mismo)", () => {
    const { errores } = evaluarConteo({ partes: [parte("p1", [A, B]), parte("p2", [B, C])], lista: LISTA, esperadas: 2 });
    expect(errores).toContain("El spec b.spec.ts aparece en dos partes: p1 y p2");
    expect(errores.join("\n")).toMatch(/Sobran 1 pruebas que las partes corrieron de más/);
  });

  it("MUTACIÓN: un spec que ninguna parte corrió", () => {
    const { errores } = evaluarConteo({ partes: [parte("p1", [A]), parte("p2", [C])], lista: LISTA, esperadas: 2 });
    expect(errores).toContain("Faltan 1 specs de `playwright test --list` que ninguna parte corrió: b.spec.ts");
    expect(errores.join("\n")).toMatch(/Faltan 1 pruebas de la lista que las partes no corrieron/);
    expect(errores.join("\n")).toMatch(/Las partes suman 4 pruebas y la lista entera tiene 5/);
  });

  it("MUTACIÓN: una prueba menos dentro de un spec que sí corrió", () => {
    const sinUna = archivo("a.spec.ts", [{ titulo: "uno", linea: 5 }]);
    const { errores } = evaluarConteo({ partes: [parte("p1", [sinUna]), parte("p2", [B, C])], lista: LISTA, esperadas: 2 });
    expect(errores.join("\n")).toMatch(/Faltan 1 pruebas de la lista que las partes no corrieron: a\.spec\.ts::9::dos/);
  });

  it("MUTACIÓN: una prueba repetida en la misma parte", () => {
    const repetida = archivo("a.spec.ts", [
      { titulo: "uno", linea: 5 },
      { titulo: "uno", linea: 5 },
      { titulo: "dos", linea: 9 },
    ]);
    const { errores } = evaluarConteo({ partes: [parte("p1", [repetida]), parte("p2", [B, C])], lista: LISTA, esperadas: 2 });
    expect(errores.join("\n")).toMatch(/Sobran 1 pruebas que las partes corrieron de más/);
    expect(errores.join("\n")).toMatch(/Las partes suman 6 pruebas y la lista entera tiene 5/);
  });

  it("MUTACIÓN: un spec que corrió y no está en la lista", () => {
    const { errores } = evaluarConteo({ partes: [parte("p1", [A, archivo("z.spec.ts", [{ titulo: "z", linea: 1 }])]), parte("p2", [B, C])], lista: LISTA, esperadas: 2 });
    expect(errores).toContain("Corrieron 1 specs que `playwright test --list` no lista: z.spec.ts");
  });

  it("MUTACIÓN: las cuentas de «stats» no cierran con el árbol del resultado", () => {
    const rota: ParteDeResultado = { nombre: "p1", json: { ...resultado([A]), stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, duration: 1 } } };
    const { errores } = evaluarConteo({ partes: [rota, parte("p2", [B, C])], lista: LISTA, esperadas: 2 });
    expect(errores).toContain("p1: las cuentas de «stats» suman 1 y el árbol del resultado trae 2 pruebas");
  });

  it("MUTACIÓN: una prueba fallada deja rojo el conteo (además de la parte que falló)", () => {
    const roja = archivo("b.spec.ts", [{ titulo: "tres", linea: 4, estado: "unexpected" }]);
    const { errores, texto } = evaluarConteo({ partes: [parte("p1", [A]), parte("p2", [roja, C])], lista: LISTA, esperadas: 2 });
    expect(errores).toEqual(["Hay 1 pruebas falladas"]);
    expect(texto).toContain("- fallados: 1");
  });

  it("MUTACIÓN: una lista vacía (el --list no encontró nada) no da por buena una suite que no se pudo comparar", () => {
    const { errores } = evaluarConteo({ partes: BIEN, lista: { suites: [] }, esperadas: 2 });
    expect(errores.join("\n")).toMatch(/La lista de `playwright test --list` vino vacía/);
  });

  it("los describe anidados cuentan en el nombre de la prueba (dos pruebas con el mismo título en describe distintos son distintas)", () => {
    const anidado = (titulos: [string, string]) => ({
      title: "d.spec.ts",
      file: "d.spec.ts",
      specs: [],
      suites: titulos.map((t, i) => ({ title: t, specs: [{ title: "mismo", file: "d.spec.ts", line: 10 + i * 0, tests: [{ status: "expected" }] }], suites: [] })),
    });
    const conStats = (titulos: [string, string]): ResultadoPlaywright => ({ stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 0 }, suites: [anidado(titulos)] });
    const lista = conStats(["grupo 1", "grupo 2"]);
    expect(evaluarConteo({ partes: [{ nombre: "p1", json: lista }], lista, esperadas: 1 }).errores).toEqual([]);
    const otra = conStats(["grupo 1", "grupo 1"]);
    expect(evaluarConteo({ partes: [{ nombre: "p1", json: otra }], lista, esperadas: 1 }).errores.join("\n")).toMatch(/Faltan 1 pruebas de la lista/);
  });
});
