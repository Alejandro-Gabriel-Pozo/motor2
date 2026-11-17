import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { alcanceDelCambio, rutasDeGitConNul } from "../../scripts/alcance-del-cambio";

/**
 * El filtro de alcance del CI (dueño, 2026-11-17: «Priorizá los PR de CI que ahorran cola», «si»): un pull request que toca SOLO `docs/` o archivos `.md` corre Estático e Integración y SALTA Build y los 7 shards de E2E;
 * cualquier otro cambio corre todo. Este guardián fija las cuatro piezas, cada una con su oráculo escrito aparte del código:
 *  1. `scripts/alcance-del-cambio.ts`: dado un listado de rutas, «solo-docs» o «completo» (todo nace cerrado: solo se ahorra si CADA ruta lo justifica).
 *  2. El paso «Filtro de alcance» del job `alcance`, corrido de verdad en un repositorio git temporal con una fusión como la que arma GitHub (solo docs, mezcla, push, sin fusión, script roto).
 *  3. El primer paso del job `gate` («Gate (requerido)»), corrido con bash sobre TODAS las combinaciones de resultados: un job omitido solo vale si el filtro terminó bien y dijo «solo-docs».
 *  4. La estructura del workflow (`ci.yml`): Build y E2E dependen de `alcance` y llevan la condición exacta; Estático e Integración no dependen de él y corren siempre.
 */
const RAIZ = join(__dirname, "../..");
const leer = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8").replace(/\r\n/g, "\n");
const ci = leer(".github/workflows/ci.yml");

// ---- 1. El filtro, con su oráculo ----

describe("alcanceDelCambio: «solo-docs» únicamente si TODAS las rutas son de documentación", () => {
  const casos: { titulo: string; rutas: string[]; esperado: "solo-docs" | "completo" }[] = [
    { titulo: "un .md de docs", rutas: ["docs/diseno-x.md"], esperado: "solo-docs" },
    { titulo: "un .md de docs a cualquier profundidad (docs/sub/x.md)", rutas: ["docs/sub/x.md", "docs/a/b/c.md"], esperado: "solo-docs" },
    { titulo: "los .md de la raíz (README.md, CLAUDE.md, AGENTS.md)", rutas: ["AGENTS.md", "README.md", "CLAUDE.md"], esperado: "solo-docs" },
    { titulo: "docs y .md de la raíz juntos", rutas: ["docs/a.md", "CLAUDE.md"], esperado: "solo-docs" },
    { titulo: "un .md dentro de src/ NO cuenta", rutas: ["src/x.md"], esperado: "completo" },
    { titulo: "un .md dentro de test/ NO cuenta", rutas: ["test/x.md"], esperado: "completo" },
    { titulo: "un .md dentro de prisma/ o scripts/ o .github/ NO cuenta", rutas: ["prisma/migrations/LEEME.md"], esperado: "completo" },
    { titulo: "un .md dentro de src/app NO cuenta (carpeta profunda)", rutas: ["src/app/LEEME.md"], esperado: "completo" },
    { titulo: "una imagen de docs/ NO cuenta (docs/x.png)", rutas: ["docs/x.png"], esperado: "completo" },
    { titulo: "capturas en docs/ (png, webp) NO cuentan", rutas: ["docs/capturas/a.png", "docs/capturas/b/c.webp"], esperado: "completo" },
    { titulo: "un json o un ts dentro de docs/ NO cuenta", rutas: ["docs/datos.json", "docs/x.ts"], esperado: "completo" },
    { titulo: "mezcla: un .md de docs y una imagen de docs", rutas: ["docs/a.md", "docs/a.png"], esperado: "completo" },
    { titulo: "un archivo de la raíz que no es .md (package.json, LICENSE)", rutas: ["LICENSE"], esperado: "completo" },
    { titulo: "código de la aplicación", rutas: ["src/x.ts"], esperado: "completo" },
    { titulo: "prisma/**", rutas: ["prisma/migrations/20261117_x/migration.sql"], esperado: "completo" },
    { titulo: ".github/** (el workflow)", rutas: [".github/workflows/ci.yml"], esperado: "completo" },
    { titulo: "tests", rutas: ["test/arquitectura/x.test.ts"], esperado: "completo" },
    { titulo: "package.json", rutas: ["package.json"], esperado: "completo" },
    { titulo: "mezcla: docs y código", rutas: ["docs/a.md", "src/x.ts"], esperado: "completo" },
    { titulo: "mezcla: el código al final de una lista larga", rutas: ["docs/a.md", "docs/b.md", "docs/c.png", "scripts/y.ts"], esperado: "completo" },
    { titulo: "listado vacío (no hay nada que justificar el salto)", rutas: [], esperado: "completo" },
    { titulo: "una ruta vacía", rutas: ["docs/a.md", ""], esperado: "completo" },
    { titulo: "ruta absoluta", rutas: ["/docs/a.md"], esperado: "completo" },
    { titulo: "ruta que sube de carpeta (`docs/../src/x.ts`)", rutas: ["docs/../src/x.ts"], esperado: "completo" },
    { titulo: "ruta con `.` o `//`", rutas: ["docs/./a.md"], esperado: "completo" },
    { titulo: "ruta con barra invertida", rutas: ["docs\\a.md"], esperado: "completo" },
    { titulo: "`docs` sin barra (un archivo llamado docs)", rutas: ["docs"], esperado: "completo" },
    { titulo: "una carpeta que empieza como docs (`docs-extra/`) no es docs/", rutas: ["docs-extra/a.ts"], esperado: "completo" },
    { titulo: "`.MD` en mayúscula y `.markdown` no cuentan", rutas: ["x/A.MD"], esperado: "completo" },
    { titulo: "termina en md pero no es .md (`src/cmd`)", rutas: ["src/cmd"], esperado: "completo" },
    { titulo: "un movimiento de src/ a docs/ lista las DOS rutas (con --no-renames)", rutas: ["src/x.ts", "docs/x.ts"], esperado: "completo" },
  ];
  for (const c of casos) it(`${c.titulo} → ${c.esperado}`, () => expect(alcanceDelCambio(c.rutas)).toBe(c.esperado));

  it("rutasDeGitConNul: separa por NUL, ignora el último separador y conserva una ruta vacía de verdad", () => {
    expect(rutasDeGitConNul("docs/a.md\0src/x.ts\0")).toEqual(["docs/a.md", "src/x.ts"]);
    expect(rutasDeGitConNul("")).toEqual([]);
    expect(alcanceDelCambio(rutasDeGitConNul("docs/a.md\0\0docs/b.md\0"))).toBe("completo");
    expect(alcanceDelCambio(rutasDeGitConNul("un archivo con\nsalto.md\0"))).toBe("completo"); // un salto de línea no está en lo permitido
    expect(alcanceDelCambio(rutasDeGitConNul("docs/capturas/ñandú (1).md\0"))).toBe("solo-docs");
  });

  it("la línea de comandos (`node scripts/alcance-del-cambio.ts`) responde igual y, ante cualquier problema, «completo»", () => {
    const correr = (entrada: string | Buffer) => spawnSync("node", ["scripts/alcance-del-cambio.ts"], { cwd: RAIZ, input: entrada, encoding: "utf8" }).stdout.trim();
    expect(correr("docs/a.md\0README.md\0")).toBe("solo-docs");
    expect(correr("docs/a.md\0src/x.ts\0")).toBe("completo");
    expect(correr("")).toBe("completo");
    expect(correr(Buffer.from([0xff, 0xfe, 0x00]))).toBe("completo");
  });
});

// ---- 2. El paso «Filtro de alcance» corrido de verdad ----

/** El texto de un job: desde `  <job>:` hasta el siguiente job. */
function trozoDeJob(workflow: string, job: string): string {
  const inicio = new RegExp(`^  ${job}:\\s*$`, "m").exec(workflow);
  if (!inicio) return "";
  const resto = workflow.slice(inicio.index + inicio[0].length);
  const siguiente = /^  [a-z0-9-]+:\s*$/m.exec(resto);
  return siguiente ? resto.slice(0, siguiente.index) : resto;
}

/** El script de un paso (`run: |`): las líneas con sangría de 10 espacios que siguen, sin esa sangría. */
function scriptDelPaso(job: string, nombre: string): string {
  const inicio = new RegExp(`^      - name: ${nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").exec(job);
  if (!inicio) throw new Error(`no hay un paso «${nombre}»`);
  const resto = job.slice(inicio.index + inicio[0].length);
  const pasoSiguiente = /^      - name:/m.exec(resto);
  const paso = pasoSiguiente ? resto.slice(0, pasoSiguiente.index) : resto;
  const run = /^ {8}run: \|\n((?: {10}.*\n|\n)+)/m.exec(paso);
  if (!run) throw new Error(`el paso «${nombre}» no tiene un \`run: |\``);
  return run[1]!.split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
}

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Un repositorio con `main` y una rama que cambia `cambios` (ruta → contenido; null borra), fusionada con `--no-ff` como la fusión de prueba que arma GitHub. Devuelve la carpeta. */
function repoConFusion(cambios: Record<string, string | null>, opciones: { fusion?: boolean; scriptRoto?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "alcance-"));
  git(dir, "init", "-q", "-b", "main");
  mkdirSync(join(dir, "scripts"));
  if (opciones.scriptRoto) writeFileSync(join(dir, "scripts", "alcance-del-cambio.ts"), "esto no es un script de node ((((\n");
  else copyFileSync(join(RAIZ, "scripts", "alcance-del-cambio.ts"), join(dir, "scripts", "alcance-del-cambio.ts"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "docs"));
  writeFileSync(join(dir, "src", "x.ts"), "export const x = 1;\n");
  writeFileSync(join(dir, "docs", "a.md"), "# a\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "pr");
  for (const [ruta, contenido] of Object.entries(cambios)) {
    mkdirSync(join(dir, ruta, ".."), { recursive: true });
    if (contenido === null) rmSync(join(dir, ruta));
    else writeFileSync(join(dir, ruta), contenido);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "cambio");
  git(dir, "checkout", "-q", "main");
  // Algo nuevo en main después de bifurcar: el filtro mira lo que cambia el PR, no lo que cambió main.
  mkdirSync(join(dir, "de-main"));
  writeFileSync(join(dir, "de-main", "otra-cosa.ts"), "export const m = 2;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "main avanza");
  if (opciones.fusion === false) git(dir, "checkout", "-q", "pr");
  else git(dir, "merge", "-q", "--no-ff", "-m", "fusión de prueba", "pr");
  return dir;
}

/** Corre el paso «Filtro de alcance» del ci.yml real en `dir` con ese evento; devuelve lo que escribe en `$GITHUB_OUTPUT`. */
function correrElFiltro(dir: string, evento: string): string {
  const script = scriptDelPaso(trozoDeJob(ci, "alcance"), "Filtro de alcance").replace("${{ github.event_name }}", evento);
  const salida = join(dir, "github-output.txt");
  writeFileSync(salida, "");
  const r = spawnSync("bash", ["-e", "-c", script], { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: salida }, encoding: "utf8" });
  expect(r.status, `el paso falló: ${r.stderr}`).toBe(0);
  return readFileSync(salida, "utf8").trim();
}

describe("el paso «Filtro de alcance» del job `alcance` (ci.yml real, en un repositorio git temporal)", () => {
  const casos: { titulo: string; cambios: Record<string, string | null>; evento?: string; opciones?: { fusion?: boolean; scriptRoto?: boolean }; esperado: string }[] = [
    { titulo: "PR que solo agrega docs (aunque main haya avanzado con código)", cambios: { "docs/nuevo.md": "# n\n", "docs/sub/otro.md": "# o\n" }, esperado: "alcance=solo-docs" },
    { titulo: "PR que agrega una captura (png) en docs/: completo", cambios: { "docs/nuevo.md": "# n\n", "docs/capturas/c.png": "png" }, esperado: "alcance=completo" },
    { titulo: "PR que agrega un .md dentro de src/: completo", cambios: { "src/LEEME.md": "# l\n" }, esperado: "alcance=completo" },
    { titulo: "PR que solo cambia un .md de la raíz", cambios: { "LEEME.md": "x\n" }, esperado: "alcance=solo-docs" },
    { titulo: "PR mixto: docs y código", cambios: { "docs/nuevo.md": "# n\n", "src/x.ts": "export const x = 3;\n" }, esperado: "alcance=completo" },
    { titulo: "PR que solo toca el workflow", cambios: { ".github/workflows/ci.yml": "name: CI\n" }, esperado: "alcance=completo" },
    { titulo: "PR que borra un archivo de código", cambios: { "src/x.ts": null }, esperado: "alcance=completo" },
    { titulo: "PR que mueve un archivo de src/ a docs/ (--no-renames lista las dos rutas)", cambios: { "src/x.ts": null, "docs/x.ts": "export const x = 1;\n" }, esperado: "alcance=completo" },
    { titulo: "un push (aunque solo cambie docs) es siempre completo", cambios: { "docs/nuevo.md": "# n\n" }, evento: "push", esperado: "alcance=completo" },
    { titulo: "una corrida manual es siempre completa", cambios: { "docs/nuevo.md": "# n\n" }, evento: "workflow_dispatch", esperado: "alcance=completo" },
    { titulo: "pull_request sin la fusión de prueba (HEAD sin segundo padre): completo", cambios: { "docs/nuevo.md": "# n\n" }, opciones: { fusion: false }, esperado: "alcance=completo" },
    { titulo: "el script falla (no se puede leer): completo", cambios: { "docs/nuevo.md": "# n\n" }, opciones: { scriptRoto: true }, esperado: "alcance=completo" },
  ];
  for (const c of casos) {
    it(c.titulo, () => {
      const dir = repoConFusion(c.cambios, c.opciones);
      try {
        expect(correrElFiltro(dir, c.evento ?? "pull_request")).toBe(c.esperado);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

// ---- 3. El primer paso del gate, con todas las combinaciones ----

const GATE = trozoDeJob(ci, "gate");
const PASO_DEL_GATE = "Todos los jobs terminaron en verde";

interface Entrada {
  alcanceResultado: string;
  alcanceSalida: string;
  estatico: string;
  integracion: string;
  build: string;
  e2e: string;
}

/** El oráculo, escrito aparte del YAML: el gate pasa si Estático e Integración dieron success y Build y E2E dieron success, o NO corrieron (skipped) porque el filtro terminó en success y dijo exactamente «solo-docs». */
function debePasar(e: Entrada): boolean {
  if (e.estatico !== "success" || e.integracion !== "success") return false;
  if (e.alcanceResultado === "success" && e.alcanceSalida === "solo-docs") return e.build === "skipped" && e.e2e === "skipped";
  return e.build === "success" && e.e2e === "success";
}

function pasaElGate(script: string, e: Entrada): boolean {
  const texto = script
    .replaceAll("${{ needs.alcance.result }}", e.alcanceResultado)
    .replaceAll("${{ needs.alcance.outputs.alcance }}", e.alcanceSalida)
    .replaceAll("${{ needs.estatico.result }}", e.estatico)
    .replaceAll("${{ needs.integracion.result }}", e.integracion)
    .replaceAll("${{ needs.build.result }}", e.build)
    .replaceAll("${{ needs.e2e.result }}", e.e2e);
  return spawnSync("bash", ["-e", "-c", texto], { encoding: "utf8" }).status === 0;
}

const COMBINACIONES: Entrada[] = [];
for (const alcanceResultado of ["success", "failure", "skipped"])
  for (const alcanceSalida of ["solo-docs", "completo", ""])
    for (const estatico of ["success", "failure"])
      for (const integracion of ["success", "failure"])
        for (const build of ["success", "failure", "skipped", "cancelled"])
          for (const e2e of ["success", "failure", "skipped", "cancelled"]) COMBINACIONES.push({ alcanceResultado, alcanceSalida, estatico, integracion, build, e2e });

function divergencias(script: string): string[] {
  return COMBINACIONES.filter((e) => pasaElGate(script, e) !== debePasar(e)).map((e) => JSON.stringify(e));
}

describe("el primer paso del Gate: un job omitido solo vale si el filtro lo justifica (todas las combinaciones, con bash)", () => {
  const real = scriptDelPaso(GATE, PASO_DEL_GATE);

  it("el oráculo tiene casos de las dos clases (si no, no prueba nada)", () => {
    expect(COMBINACIONES.filter(debePasar).length).toBeGreaterThan(2);
    expect(COMBINACIONES.filter((e) => !debePasar(e)).length).toBeGreaterThan(100);
  });

  it("el gate real coincide con el oráculo en las 576 combinaciones", { timeout: 120_000 }, () => {
    expect(divergencias(real)).toEqual([]);
  });

  const mutaciones: { titulo: string; de: string | RegExp; a: string }[] = [
    { titulo: "el salto se acepta sin mirar que el filtro terminó bien (falla el job del filtro y aun así se omite)", de: '[ "${{ needs.alcance.result }}" = "success" ] && ', a: "" },
    { titulo: "el salto se acepta con cualquier salida que no sea «completo»", de: '= "solo-docs" ]', a: '!= "completo" ]' },
    { titulo: "Build y E2E con skipped también valen fuera del filtro (permisivo)", de: /(else\n\s+test "\$\{\{ needs\.build\.result \}\}" = "success") -a/, a: '$1 -o "${{ needs.build.result }}" = "skipped" -a' },
    { titulo: "dentro del filtro basta que corran en verde, en vez de omitirse", de: /(then\n\s+test "\$\{\{ needs\.build\.result \}\}" = )"skipped"/, a: '$1"success"' },
    { titulo: "se deja de exigir Integración", de: ' -a "${{ needs.integracion.result }}" = "success"', a: "" },
    { titulo: "se deja de exigir Estático", de: 'test "${{ needs.estatico.result }}" = "success" -a ', a: "test " },
    { titulo: "E2E sin exigir en el camino completo", de: / -a "\$\{\{ needs\.e2e\.result \}\}" = "success"\n\s*fi/, a: "\nfi" },
  ];
  for (const m of mutaciones) {
    it(`pone rojo: ${m.titulo}`, { timeout: 120_000 }, () => {
      const mutado = real.replace(m.de, m.a);
      expect(mutado, "la mutación no cambió nada").not.toBe(real);
      expect(divergencias(mutado).length).toBeGreaterThan(0);
    });
  }
});

// ---- 4. La estructura del workflow ----

describe("ci.yml: dónde se aplica el filtro", () => {
  const CONDICION = "if: ${{ !cancelled() && !(github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.CI_EN_MAIN != 'si') && needs.alcance.outputs.alcance != 'solo-docs' }}";

  it("Build y E2E dependen de `alcance` y llevan la condición exacta (se omiten solo con «solo-docs»; corren si el filtro falla)", () => {
    for (const job of ["build", "e2e"]) {
      const texto = trozoDeJob(ci, job);
      expect(texto, job).toMatch(/^ {4}needs: \[alcance\]\s*$/m);
      expect(texto, job).toContain(`    ${CONDICION}\n`);
    }
  });

  it("Estático e Integración NO dependen del filtro y corren siempre (los guardianes de arquitectura leen docs/)", () => {
    for (const job of ["estatico", "integracion"]) {
      const texto = trozoDeJob(ci, job);
      expect(texto, job).not.toMatch(/alcance/);
      expect(texto, job).not.toMatch(/^ {4}needs:/m);
    }
  });

  it("el job `alcance` no instala nada, mira solo la fusión (fetch-depth 2) y su salida es el valor del paso", () => {
    const texto = trozoDeJob(ci, "alcance");
    expect(texto).not.toMatch(/npm ci|npm install|setup-node/);
    expect(texto).toMatch(/fetch-depth: 2/);
    expect(texto).toMatch(/^ {6}alcance: \$\{\{ steps\.filtro\.outputs\.alcance \}\}\s*$/m);
    expect(texto).toMatch(/git diff --no-renames --name-only -z HEAD\^1 HEAD \| node scripts\/alcance-del-cambio\.ts/);
    expect(texto).not.toMatch(/continue-on-error/);
  });

  it("el gate sigue esperando a TODOS los jobs, incluido el filtro, y el conteo de Vitest corre también cuando E2E se omitió", () => {
    expect(GATE).toMatch(/^ {4}needs: \[alcance, estatico, build, integracion, e2e\]\s*$/m);
    for (const paso of ["Checkout", "Node", "npm ci", "Resultados de Vitest (todas las partes)", "Conteo de tests (todas las partes)"]) {
      expect(GATE, paso).toMatch(new RegExp(`- name: ${paso.replace(/[()]/g, "\\$&")}\\n {8}if: \\$\\{\\{ needs\\.integracion\\.result == 'success' \\}\\}\\n`));
    }
    for (const paso of ["Resultados de Playwright (todas las partes)", "Lista de specs de la suite entera (sin correr nada)", "Conteo de E2E (todas las partes)"]) {
      expect(GATE, paso).toMatch(new RegExp(`- name: ${paso.replace(/[()]/g, "\\$&")}\\n {8}if: \\$\\{\\{ needs\\.integracion\\.result == 'success' && needs\\.e2e\\.result == 'success' \\}\\}\\n`));
    }
  });

  it("el workflow no filtra por rutas (`paths`) ni toca la perilla ni los workflows de seguridad", () => {
    expect(ci).not.toMatch(/^\s+paths(-ignore)?:/m);
    expect(ci).toMatch(/vars\.CI_EN_MAIN != 'si'/);
    for (const archivo of [".github/workflows/seguridad.yml", ".github/workflows/codeql.yml", ".github/workflows/gitleaks.yml"]) expect(leer(archivo), archivo).not.toMatch(/alcance/);
  });
});
