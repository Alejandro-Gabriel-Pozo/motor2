import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO } from "../../cercos/trinquete";
import {
  GUARDIANES_ADICIONALES,
  TIPOS_DE_CUMPLIMIENTO,
  evaluarCableado,
  evaluarConfigDeVitest,
  evaluarManifiesto,
  evaluarPruebaProtegida,
  evaluarScripts,
  evaluarWorkflow,
  formatearHallazgoDeCumplimiento,
  formatearReporteDeCumplimiento,
  patronAlcanza,
  resumirCumplimiento,
  revisarCumplimiento,
  type HallazgoDeCumplimiento,
  type TipoDeCumplimiento,
} from "./cumplimiento";

/**
 * Guardián «el cableado del guardián» (G6): `cumplimiento.ts` sobre el repo real (0 hallazgos), cada evaluador con sus casos rojo y verde con textos LITERALES (nada importado: si alguien
 * cambia una constante del evaluador, estos casos lo notan) y las mutaciones a mano sobre una COPIA del repo (nunca el repo real): `describe.skip`, un `exclude` en `vitest.config.ts`,
 * el test renombrado a un `.ts`, `continue-on-error` en el paso de `npm test`, el script `test` quitado y el paso reemplazado.
 */

const vistos = new Set<TipoDeCumplimiento>();
const anotar = (hallazgos: readonly HallazgoDeCumplimiento[]): HallazgoDeCumplimiento[] => {
  for (const h of hallazgos) vistos.add(h.tipo);
  return [...hallazgos];
};
const resumen = (hallazgos: readonly HallazgoDeCumplimiento[]): [string, number][] => hallazgos.map((h) => [h.tipo, h.linea]);
const lineaDe = (texto: string, fragmento: string): number => {
  const i = texto.indexOf(fragmento);
  if (i < 0) throw new Error(`el caso de prueba no contiene «${fragmento}»`);
  return texto.slice(0, i).split("\n").length;
};
const sinCorreccion = (hallazgos: readonly HallazgoDeCumplimiento[]): string[] => hallazgos.filter((h) => h.como.trim() === "" || h.linea < 1).map((h) => h.tipo);

// ---------------------------------------------------------------------------------------------------------------------------------
// El repo real
// ---------------------------------------------------------------------------------------------------------------------------------

describe("cumplimiento del cableado del guardián (repo real)", () => {
  it("ci.yml, package.json, vitest.config.ts, los tests protegidos y el manifiesto cumplen: 0 hallazgos", () => {
    const t0 = performance.now();
    const r = revisarCumplimiento(RAIZ_DEL_REPO);
    // El conteo y el tiempo salen siempre, también en verde.
    console.info(`[cumplimiento] ${resumirCumplimiento(r)} · ${(performance.now() - t0).toFixed(0)} ms`);
    expect(r.hallazgos.map(formatearHallazgoDeCumplimiento), `\n${formatearReporteDeCumplimiento(r)}`).toEqual([]);
  });

  it("los tests protegidos incluyen el propio guardián y los guardianes adicionales que existen", () => {
    const r = revisarCumplimiento(RAIZ_DEL_REPO);
    for (const ruta of ["test/arquitectura/contratos/contratos.test.ts", "test/arquitectura/contratos/gobernanza/cumplimiento.test.ts", "test/arquitectura/contratos/gobernanza/aprobaciones.test.ts", ...GUARDIANES_ADICIONALES]) {
      expect(r.protegidos, ruta).toContain(ruta);
      expect(existsSync(join(RAIZ_DEL_REPO, ...ruta.split("/"))), ruta).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// (a) ci.yml
// ---------------------------------------------------------------------------------------------------------------------------------

const SHA = "a".repeat(40);
const CI_VALIDO = [
  "name: CI",
  "on:",
  "  push:",
  "    branches: [main]",
  "  pull_request:",
  "    branches: [main]",
  "jobs:",
  "  estatico:",
  "    name: Estático",
  "    runs-on: ubuntu-latest",
  "    steps:",
  `      - uses: actions/checkout@${SHA} # v4.4.0`,
  "      - run: npm ci",
  "      - run: npm run arquitectura",
  "  build:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npm run build",
  "  integracion:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: npm test",
  "        run: npm test -- --shard=1/4",
  "        env:",
  "          X: y",
  "      - name: Tests que fallaron (resumen al final del log)",
  "        if: failure()",
  "        run: |",
  "          echo '# no es un comentario de YAML, es el script'",
  "          echo continue-on-error: true",
  "  conteo:",
  "    needs: [integracion]",
  "    if: always()",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: echo conteo",
  "  e2e:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: npm run test:e2e",
  "  gate:",
  "    name: Gate (requerido)",
  "    if: always()",
  "    needs: [estatico, build, integracion, conteo, e2e]",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Todos los jobs terminaron en verde",
  "        run: |",
  '          test "${{ needs.estatico.result }}" = "success" -a "${{ needs.build.result }}" = "success" -a "${{ needs.integracion.result }}" = "success" -a "${{ needs.conteo.result }}" = "success" -a "${{ needs.e2e.result }}" = "success"',
  "",
].join("\n");

describe("evaluarWorkflow (ci.yml)", () => {
  it("un workflow completo cumple (el `#` y el `continue-on-error` dentro de un script de `run: |` no son claves)", () => {
    expect(evaluarWorkflow(CI_VALIDO)).toEqual([]);
  });

  const casos: { titulo: string; de: string; a: string; tipo: TipoDeCumplimiento; donde: string }[] = [
    { titulo: "un job del gate desaparece (se renombra)", de: "  build:\n", a: "  construir:\n", tipo: "ci-job-ausente", donde: "jobs:" },
    { titulo: "el paso de `npm test` se reemplaza por un echo", de: "run: npm test -- --shard=1/4", a: "run: echo omitido -- --shard=1/4", tipo: "ci-sin-paso", donde: "  integracion:" },
    { titulo: "el paso de `npm run arquitectura` se reemplaza", de: "- run: npm run arquitectura", a: "- run: echo omitido", tipo: "ci-sin-paso", donde: "  estatico:" },
    { titulo: "`continue-on-error: true` en el paso de `npm test`", de: "      - name: npm test\n", a: "      - name: npm test\n        continue-on-error: true\n", tipo: "ci-continue-on-error", donde: "continue-on-error: true" },
    { titulo: "`continue-on-error: true` en un job", de: "  build:\n", a: "  build:\n    continue-on-error: true\n", tipo: "ci-continue-on-error", donde: "continue-on-error: true" },
    { titulo: "`continue-on-error` con una expresión", de: "  build:\n", a: "  build:\n    continue-on-error: ${{ github.event_name == 'push' }}\n", tipo: "ci-continue-on-error", donde: "continue-on-error: ${{" },
    { titulo: "un `if` en el paso de `npm test`", de: "      - name: npm test\n", a: "      - name: npm test\n        if: github.ref == 'refs/heads/main'\n", tipo: "ci-condicion-no-permitida", donde: "if: github.ref" },
    { titulo: "un `if` en el paso de `npm run arquitectura` (aunque sea `always()`)", de: "      - run: npm run arquitectura", a: "      - if: always()\n        run: npm run arquitectura", tipo: "ci-condicion-no-permitida", donde: "if: always()\n        run: npm run arq" },
    { titulo: "un `if` en un job que no está en la lista permitida", de: "  build:\n", a: "  build:\n    if: github.actor != 'bot'\n", tipo: "ci-condicion-no-permitida", donde: "if: github.actor" },
    { titulo: "un `if` permitido pero con otra condición", de: "        if: failure()\n", a: "        if: success()\n", tipo: "ci-condicion-no-permitida", donde: "if: success()" },
    { titulo: "el paso de `npm test` cambia de carpeta", de: "        run: npm test -- --shard=1/4\n", a: "        working-directory: otra\n        run: npm test -- --shard=1/4\n", tipo: "ci-paso-alterado", donde: "working-directory: otra" },
    { titulo: "el paso de `npm test` cambia de intérprete", de: "        run: npm test -- --shard=1/4\n", a: "        shell: bash {0}\n        run: npm test -- --shard=1/4\n", tipo: "ci-paso-alterado", donde: "shell: bash" },
    { titulo: "el gate deja de esperar a `e2e`", de: "needs: [estatico, build, integracion, conteo, e2e]", a: "needs: [estatico, build, integracion, conteo]", tipo: "ci-gate-sin-needs", donde: "needs: [estatico, build, integracion, conteo]" },
    { titulo: "la expresión del gate deja de nombrar a `conteo`", de: ' -a "${{ needs.conteo.result }}" = "success"', a: "", tipo: "ci-gate-expresion", donde: "- name: Todos los jobs" },
    { titulo: "el gate cambia de nombre", de: "name: Gate (requerido)", a: "name: Gate", tipo: "ci-gate-renombrado", donde: "name: Gate" },
    { titulo: "`paths` en el disparador", de: "    branches: [main]\n  pull_request:", a: "    branches: [main]\n    paths: ['src/**']\n  pull_request:", tipo: "ci-filtro-de-rutas", donde: "paths: ['src" },
    { titulo: "`paths-ignore` en el disparador", de: "  pull_request:\n    branches: [main]\n", a: "  pull_request:\n    branches: [main]\n    paths-ignore: ['test/**']\n", tipo: "ci-filtro-de-rutas", donde: "paths-ignore:" },
    { titulo: "`CREAR_CERCOS` en un `env`", de: "          X: y\n", a: "          X: y\n          CREAR_CERCOS: '1'\n", tipo: "ci-variable-prohibida", donde: "CREAR_CERCOS" },
    { titulo: "`BAJAR_CERCOS=1` delante de un comando", de: "      - run: npm run build", a: "      - run: BAJAR_CERCOS=1 npm run build", tipo: "ci-variable-prohibida", donde: "BAJAR_CERCOS=1" },
    { titulo: "una variable que regenera un golden", de: "          X: y\n", a: "          X: y\n          REGENERAR_HUELLA_DE_LOGIN: '1'\n", tipo: "ci-variable-prohibida", donde: "REGENERAR_HUELLA" },
  ];
  for (const c of casos) {
    it(`rojo: ${c.titulo}`, () => {
      expect(CI_VALIDO.includes(c.de), `el caso necesita «${c.de}» en el workflow válido`).toBe(true);
      const mal = CI_VALIDO.replace(c.de, c.a);
      const r = anotar(evaluarWorkflow(mal));
      expect(resumen(r)).toEqual([[c.tipo, lineaDe(mal, c.donde)]]);
      expect(sinCorreccion(r)).toEqual([]);
      expect(r[0].archivo).toBe(".github/workflows/ci.yml");
    });
  }

  it("verde: `continue-on-error: false`, un comentario que nombra `CREAR_CERCOS` y los `if` de la lista permitida", () => {
    const bien = CI_VALIDO.replace("  build:\n", "  build:\n    continue-on-error: false\n").replace("  build:", "  # nunca CREAR_CERCOS=1 acá\n  build:");
    expect(evaluarWorkflow(bien)).toEqual([]);
  });

  it("rojo: sin `jobs` o sin `on` el workflow no se puede comprobar (falla cerrado)", () => {
    expect(resumen(anotar(evaluarWorkflow("name: CI\non:\n  push:\n    branches: [main]\n")))).toEqual([["ci-ilegible", 1]]);
    expect(resumen(anotar(evaluarWorkflow(CI_VALIDO.replace("on:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n", ""))))).toEqual([["ci-ilegible", 1]]);
  });

  it("verde: un workflow con CRLF se lee igual", () => {
    expect(evaluarWorkflow(CI_VALIDO.replace(/\n/g, "\r\n"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// (b) package.json
// ---------------------------------------------------------------------------------------------------------------------------------

const PAQUETE_VALIDO = [
  "{",
  '  "name": "x",',
  '  "scripts": {',
  '    "arquitectura": "depcruise src plataforma next.config.ts --config .dependency-cruiser.cjs",',
  '    "test": "vitest run",',
  '    "lint": "eslint"',
  "  },",
  '  "dependencies": {}',
  "}",
  "",
].join("\n");

describe("evaluarScripts (package.json)", () => {
  it("verde: `test` vale `vitest run` y `arquitectura` conserva su valor", () => {
    expect(evaluarScripts(PAQUETE_VALIDO)).toEqual([]);
  });

  const casos: { titulo: string; de: string; a: string; tipo: TipoDeCumplimiento; donde: string }[] = [
    { titulo: "el script `test` desaparece", de: '    "test": "vitest run",\n', a: "", tipo: "script-ausente", donde: '"scripts"' },
    { titulo: "el script `test` pasa a otro comando", de: '"test": "vitest run"', a: '"test": "vitest run --passWithNoTests"', tipo: "script-distinto", donde: '"test": "vitest run --pass' },
    { titulo: "el script `test` solo hace echo", de: '"test": "vitest run"', a: '"test": "echo ok"', tipo: "script-distinto", donde: '"test": "echo ok"' },
    { titulo: "el script `arquitectura` cambia", de: "--config .dependency-cruiser.cjs", a: "--config otra.cjs", tipo: "script-distinto", donde: '"arquitectura"' },
    { titulo: "aparece un `pretest`", de: '    "lint": "eslint"', a: '    "pretest": "echo",\n    "lint": "eslint"', tipo: "script-de-ganchos", donde: '"pretest"' },
    { titulo: "aparece un `posttest`", de: '    "lint": "eslint"', a: '    "posttest": "echo",\n    "lint": "eslint"', tipo: "script-de-ganchos", donde: '"posttest"' },
  ];
  for (const c of casos) {
    it(`rojo: ${c.titulo}`, () => {
      expect(PAQUETE_VALIDO.includes(c.de), `el caso necesita «${c.de}»`).toBe(true);
      const mal = PAQUETE_VALIDO.replace(c.de, c.a);
      const r = anotar(evaluarScripts(mal));
      expect(resumen(r)).toEqual([[c.tipo, lineaDe(mal, c.donde)]]);
      expect(sinCorreccion(r)).toEqual([]);
    });
  }

  it("rojo: sin la clave `scripts` y con un JSON roto", () => {
    expect(resumen(anotar(evaluarScripts('{\n  "name": "x"\n}\n')))).toEqual([["script-ausente", 1]]);
    expect(resumen(anotar(evaluarScripts('{ "scripts": { "test": '))).map(([t]) => t)).toEqual(["package-ilegible"]);
  });

  it("verde: cambiar una dependencia no toca los scripts", () => {
    expect(evaluarScripts(PAQUETE_VALIDO.replace('"dependencies": {}', '"dependencies": { "next": "^16.0.0" }'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// (c) vitest.config.ts
// ---------------------------------------------------------------------------------------------------------------------------------

const PROTEGIDOS = ["test/arquitectura/contratos/contratos.test.ts", "test/arquitectura/contratos/gobernanza/areas.test.ts", "test/arquitectura/caracterizaciones-congeladas.test.ts"];
const VITEST_VALIDO = [
  'import { defineConfig, configDefaults } from "vitest/config";',
  "export default defineConfig({",
  "  plugins: [],",
  "  test: {",
  '    environment: "node",',
  '    exclude: [...configDefaults.exclude, "test/e2e/**", "test/e2e-demo/**"],',
  '    coverage: { exclude: ["test/arquitectura/**"] },',
  "  },",
  "});",
  "",
].join("\n");

describe("evaluarConfigDeVitest (vitest.config.ts)", () => {
  it("verde: excluir los specs de Playwright no deja afuera a ningún guardián (y el `exclude` de `coverage` no cuenta)", () => {
    expect(evaluarConfigDeVitest(VITEST_VALIDO, PROTEGIDOS)).toEqual([]);
  });

  const casos: { titulo: string; de: string; a: string; tipo: TipoDeCumplimiento; donde: string }[] = [
    { titulo: "`test/arquitectura/**` en el exclude", de: '"test/e2e/**"', a: '"test/arquitectura/**", "test/e2e/**"', tipo: "vitest-excluye-guardian", donde: '"test/arquitectura/**", "test/e2e' },
    { titulo: "la carpeta del guardián sin comodín", de: '"test/e2e/**"', a: '"test/arquitectura/contratos"', tipo: "vitest-excluye-guardian", donde: '"test/arquitectura/contratos"' },
    { titulo: "el archivo exacto del guardián", de: '"test/e2e/**"', a: '"test/arquitectura/contratos/contratos.test.ts"', tipo: "vitest-excluye-guardian", donde: '"test/arquitectura/contratos/contratos.test.ts"' },
    { titulo: "todos los `*.test.ts`", de: '"test/e2e/**"', a: '"**/*.test.ts"', tipo: "vitest-excluye-guardian", donde: '"**/*.test.ts"' },
    { titulo: "una llave de alternativas que lo alcanza", de: '"test/e2e/**"', a: '"test/{e2e,arquitectura}/**"', tipo: "vitest-excluye-guardian", donde: '"test/{e2e,arquitectura}/**"' },
    { titulo: "un `include` que no alcanza a los guardianes", de: "    environment", a: '    include: ["test/pos/**/*.test.ts"],\n    environment', tipo: "vitest-include-no-cubre", donde: "include:" },
    { titulo: "`allowOnly: true`", de: "    environment", a: "    allowOnly: true,\n    environment", tipo: "vitest-allowonly", donde: "allowOnly" },
    { titulo: "`allowOnly` con una expresión", de: "    environment", a: "    allowOnly: !process.env.CI,\n    environment", tipo: "vitest-allowonly", donde: "allowOnly" },
    { titulo: "`testNamePattern`", de: "    environment", a: '    testNamePattern: "pos",\n    environment', tipo: "vitest-clave-peligrosa", donde: "testNamePattern" },
    { titulo: "`projects`", de: "    environment", a: "    projects: [],\n    environment", tipo: "vitest-clave-peligrosa", donde: "projects" },
    { titulo: "`root` cambiado", de: "  plugins: [],", a: '  root: "test/pos",\n  plugins: [],', tipo: "vitest-clave-peligrosa", donde: "root:" },
    { titulo: "un exclude armado con una variable (no analizable)", de: '[...configDefaults.exclude, "test/e2e/**", "test/e2e-demo/**"]', a: "[...configDefaults.exclude, ...otraLista]", tipo: "vitest-no-analizable", donde: "...otraLista" },
    { titulo: "un exclude con una sintaxis de glob que no se analiza", de: '"test/e2e/**"', a: '"test/!(arquitectura)/**"', tipo: "vitest-no-analizable", donde: '"test/!(arquitectura)/**"' },
    { titulo: "una configuración con una propagación", de: "  plugins: [],", a: "  ...otra,\n  plugins: [],", tipo: "vitest-no-analizable", donde: "...otra" },
  ];
  for (const c of casos) {
    it(`rojo: ${c.titulo}`, () => {
      expect(VITEST_VALIDO.includes(c.de), `el caso necesita «${c.de}»`).toBe(true);
      const mal = VITEST_VALIDO.replace(c.de, c.a);
      const r = anotar(evaluarConfigDeVitest(mal, PROTEGIDOS));
      expect(resumen(r)).toEqual([[c.tipo, lineaDe(mal, c.donde)]]);
      expect(sinCorreccion(r)).toEqual([]);
      expect(r[0].archivo).toBe("vitest.config.ts");
    });
  }

  it("rojo: una configuración que no es `export default defineConfig({ … })` no se puede analizar", () => {
    expect(resumen(anotar(evaluarConfigDeVitest("const c = {};\nexport default c;\n", PROTEGIDOS)))).toEqual([["vitest-no-analizable", 1]]);
  });

  it("verde: un `include` que sí los alcanza", () => {
    const bien = VITEST_VALIDO.replace("    environment", '    include: ["test/**/*.test.ts"],\n    environment');
    expect(evaluarConfigDeVitest(bien, PROTEGIDOS)).toEqual([]);
  });

  it("patronAlcanza: globs y carpetas contra rutas (con literales)", () => {
    expect(patronAlcanza("test/e2e/**", "test/e2e/x.spec.ts")).toBe(true);
    expect(patronAlcanza("test/e2e/**", "test/arquitectura/x.test.ts")).toBe(false);
    expect(patronAlcanza("test/arquitectura", "test/arquitectura/contratos/a.test.ts")).toBe(true);
    expect(patronAlcanza("**/*.test.ts", "test/a/b.test.ts")).toBe(true);
    expect(patronAlcanza("**/*.test.ts", "test/a/b.test.tsx")).toBe(false);
    expect(patronAlcanza("test/*.ts", "test/a/b.ts")).toBe(false);
    expect(patronAlcanza("test/a?.ts", "test/ab.ts")).toBe(true);
    expect(patronAlcanza("test/{a,b}/*.ts", "test/b/x.ts")).toBe(true);
    expect(patronAlcanza("test/[ab]/x.ts", "test/b/x.ts")).toBe(true);
    expect(patronAlcanza("./test/a/**", "test/a/x.ts")).toBe(true);
    expect(patronAlcanza("test/!(a)/x.ts", "test/b/x.ts")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// (d) skip / only
// ---------------------------------------------------------------------------------------------------------------------------------

const TEST_VALIDO = 'import { describe, expect, it } from "vitest";\ndescribe("x", () => {\n  it("uno", () => {\n    expect(1).toBe(1);\n  });\n});\n';

describe("evaluarPruebaProtegida (skip, only, todo y compañía)", () => {
  it("verde: un test normal; una mención en un texto, en una plantilla o en un comentario NO cuenta", () => {
    expect(evaluarPruebaProtegida(TEST_VALIDO, "test/x.test.ts")).toEqual([]);
    const mencion = TEST_VALIDO.replace('expect(1).toBe(1);', 'expect("it.skip(x) y describe.only(y)").toBeTruthy();\n    expect(`xit(z) ${1} ctx.skip()`).toBeTruthy();\n    // it.todo("no") describe.skip("no")');
    expect(evaluarPruebaProtegida(mencion, "test/x.test.ts")).toEqual([]);
  });

  const casos: { titulo: string; de: string; a: string; donde: string }[] = [
    { titulo: "`describe.skip`", de: 'describe("x"', a: 'describe.skip("x"', donde: "describe.skip" },
    { titulo: "`it.skip`", de: 'it("uno"', a: 'it.skip("uno"', donde: "it.skip" },
    { titulo: "`test.skip`", de: 'it("uno"', a: 'test.skip("uno"', donde: "test.skip" },
    { titulo: "`it.only`", de: 'it("uno"', a: 'it.only("uno"', donde: "it.only" },
    { titulo: "`describe.only`", de: 'describe("x"', a: 'describe.only("x"', donde: "describe.only" },
    { titulo: "`it.todo`", de: 'it("uno"', a: 'it.todo("uno"', donde: "it.todo" },
    { titulo: "`it.skipIf(cond)`", de: 'it("uno"', a: 'it.skipIf(process.env.CI)("uno"', donde: "it.skipIf" },
    { titulo: "`describe.runIf(cond)`", de: 'describe("x"', a: 'describe.runIf(false)("x"', donde: "describe.runIf" },
    { titulo: "`ctx.skip()` dentro de un test", de: "expect(1).toBe(1);", a: "ctx.skip();\n    expect(1).toBe(1);", donde: "ctx.skip" },
    { titulo: "`it['skip']`", de: 'it("uno"', a: 'it["skip"]("uno"', donde: 'it["skip"]' },
    { titulo: "`xit(…)`", de: 'it("uno"', a: 'xit("uno"', donde: "xit(" },
    { titulo: "`xdescribe(…)`", de: 'describe("x"', a: 'xdescribe("x"', donde: "xdescribe(" },
    { titulo: "una cadena `describe.concurrent.skip`", de: 'describe("x"', a: 'describe.concurrent.skip("x"', donde: "describe.concurrent.skip" },
  ];
  for (const c of casos) {
    it(`rojo: ${c.titulo}`, () => {
      expect(TEST_VALIDO.includes(c.de), `el caso necesita «${c.de}»`).toBe(true);
      const mal = TEST_VALIDO.replace(c.de, c.a);
      const r = anotar(evaluarPruebaProtegida(mal, "test/arquitectura/contratos/contratos.test.ts")).filter((h) => h.tipo === "prueba-desactivada");
      expect(r.length).toBeGreaterThan(0);
      expect(r[0].linea).toBe(lineaDe(mal, c.donde));
      expect(sinCorreccion(r)).toEqual([]);
      expect(r[0].archivo).toBe("test/arquitectura/contratos/contratos.test.ts");
    });
  }

  it("rojo: un archivo sin ningún `it` ni `test` no verifica nada", () => {
    expect(resumen(anotar(evaluarPruebaProtegida('import { describe } from "vitest";\ndescribe("x", () => {});\n', "test/x.test.ts")))).toEqual([["guardian-sin-pruebas", 1]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// (e) cableado y (f) manifiesto
// ---------------------------------------------------------------------------------------------------------------------------------

describe("evaluarCableado (los guardianes existen, terminan en .test.ts y están bajo test/)", () => {
  const ESPERADOS = ["test/arquitectura/contratos/contratos.test.ts", "test/arquitectura/contratos/motor.test.ts"];
  const existentes = (...rutas: string[]): Map<string, string> => new Map(rutas.map((r) => [r, TEST_VALIDO]));

  it("verde: todos están", () => {
    expect(evaluarCableado(ESPERADOS, existentes(...ESPERADOS))).toEqual([]);
  });

  it("rojo: un guardián esperado ya no existe (se borró o se mudó)", () => {
    const r = anotar(evaluarCableado(ESPERADOS, existentes(ESPERADOS[1])));
    expect(resumen(r)).toEqual([["guardian-ausente", 1]]);
    expect(r[0].archivo).toBe(ESPERADOS[0]);
    expect(sinCorreccion(r)).toEqual([]);
  });

  it("rojo: renombrado a un `.ts` con pruebas, falta el guardián y aparece el archivo que no corre", () => {
    const m = existentes(ESPERADOS[1]);
    m.set("test/arquitectura/contratos/contratos-guardian.ts", TEST_VALIDO);
    const r = anotar(evaluarCableado(ESPERADOS, m));
    expect(resumen(r).sort()).toEqual([["guardian-ausente", 1], ["prueba-sin-sufijo-test", 2]]);
    expect(r.find((h) => h.tipo === "prueba-sin-sufijo-test")?.archivo).toBe("test/arquitectura/contratos/contratos-guardian.ts");
  });

  it("verde: un módulo auxiliar `.ts` sin llamadas a `describe`/`it` no es un test", () => {
    const m = existentes(...ESPERADOS);
    m.set("test/arquitectura/contratos/ayuda.ts", "export const f = () => 1;\nexport function g() {\n  return it;\n}\n");
    expect(evaluarCableado(ESPERADOS, m)).toEqual([]);
  });

  it("rojo: un guardián esperado fuera de `test/` o sin el sufijo `.test.ts`", () => {
    expect(resumen(anotar(evaluarCableado(["src/contratos.test.ts"], existentes("src/contratos.test.ts"))))).toEqual([["guardian-mal-cableado", 1]]);
    expect(resumen(evaluarCableado(["test/arquitectura/contratos/contratos.ts"], new Map()))).toEqual([["guardian-mal-cableado", 1]]);
  });
});

describe("evaluarManifiesto", () => {
  it("verde: los ids del manifiesto son los aprobados", () => {
    expect(evaluarManifiesto(["a", "b"], ["a", "b"])).toEqual([]);
  });

  it("rojo: manifiesto vacío", () => {
    const r = anotar(evaluarManifiesto([], ["a"]));
    expect(r.map((h) => h.tipo).sort()).toEqual(["aprobado-ausente-del-manifiesto", "manifiesto-vacio"]);
    expect(sinCorreccion(r)).toEqual([]);
  });

  it("rojo: un contrato sin aprobar y uno aprobado que ya no está", () => {
    const r = anotar(evaluarManifiesto(["a", "nuevo"], ["a", "viejo"]));
    expect(r.map((h) => [h.tipo, h.que.includes("nuevo") || h.que.includes("viejo")])).toEqual([
      ["contrato-sin-aprobar", true],
      ["aprobado-ausente-del-manifiesto", true],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Mutaciones a mano sobre una COPIA del repo
// ---------------------------------------------------------------------------------------------------------------------------------

describe("mutaciones sobre una copia exacta del repo (el repo real no se toca)", () => {
  let copia: string;
  const ruta = (r: string): string => join(copia, ...r.split("/"));
  const leer = (r: string): string => readFileSync(ruta(r), "utf8");
  const mostrar = (titulo: string, hallazgos: readonly HallazgoDeCumplimiento[]): void => {
    console.info(`[mutacion] ${titulo}\n${hallazgos.map(formatearHallazgoDeCumplimiento).join("\n")}`);
  };
  /** Cambia un archivo de la copia, corre el cumplimiento y lo deja como estaba. */
  const mutar = (archivo: string, de: string, a: string, titulo: string): HallazgoDeCumplimiento[] => {
    const original = leer(archivo);
    expect(original.includes(de), `«${de}» tiene que estar en ${archivo}`).toBe(true);
    writeFileSync(ruta(archivo), original.replace(de, a));
    try {
      const r = anotar(revisarCumplimiento(copia).hallazgos);
      mostrar(titulo, r);
      return r;
    } finally {
      writeFileSync(ruta(archivo), original);
    }
  };

  beforeAll(() => {
    copia = mkdtempSync(join(tmpdir(), "cumplimiento-copia-"));
    const copiar = (r: string): void => {
      mkdirSync(dirname(ruta(r)), { recursive: true });
      cpSync(join(RAIZ_DEL_REPO, ...r.split("/")), ruta(r));
    };
    const recorrer = (dir: string): void => {
      for (const n of readdirSync(join(RAIZ_DEL_REPO, ...dir.split("/")))) {
        const r = `${dir}/${n}`;
        if (statSync(join(RAIZ_DEL_REPO, ...r.split("/"))).isDirectory()) recorrer(r);
        else if (n.endsWith(".ts")) copiar(r);
      }
    };
    recorrer("test/arquitectura/contratos");
    for (const r of [".github/workflows/ci.yml", "package.json", "vitest.config.ts", ...GUARDIANES_ADICIONALES]) copiar(r);
  }, 30_000);
  afterAll(() => {
    rmSync(copia, { recursive: true, force: true });
  });

  it("la copia sin mutar da 0 hallazgos", () => {
    expect(revisarCumplimiento(copia).hallazgos.map(formatearHallazgoDeCumplimiento)).toEqual([]);
  });

  it("1. `describe.skip` en contratos.test.ts → prueba-desactivada, con archivo y línea", () => {
    const original = leer("test/arquitectura/contratos/contratos.test.ts");
    const r = mutar("test/arquitectura/contratos/contratos.test.ts", 'describe("contratos compartidos declarados (repo real)"', 'describe.skip("contratos compartidos declarados (repo real)"', "describe.skip en contratos.test.ts");
    expect(resumen(r)).toEqual([["prueba-desactivada", lineaDe(original.replace('describe("contratos compartidos', 'describe.skip("contratos compartidos'), "describe.skip")]]);
    expect(r[0].archivo).toBe("test/arquitectura/contratos/contratos.test.ts");
  });

  it("2. un `exclude` en vitest.config.ts → vitest-excluye-guardian", () => {
    const r = mutar("vitest.config.ts", 'exclude: [...configDefaults.exclude, "test/e2e/**"', 'exclude: [...configDefaults.exclude, "test/arquitectura/**", "test/e2e/**"', "exclude de test/arquitectura/** en vitest.config.ts");
    expect(r.map((h) => h.tipo)).toEqual(["vitest-excluye-guardian"]);
    expect(r[0].archivo).toBe("vitest.config.ts");
    expect(r[0].que).toContain("test/arquitectura/**");
  });

  it("3. contratos.test.ts renombrado a contratos.ts → guardian-ausente y prueba-sin-sufijo-test", () => {
    const original = ruta("test/arquitectura/contratos/contratos.test.ts");
    const renombrado = ruta("test/arquitectura/contratos/contratos.ts");
    renameSync(original, renombrado);
    try {
      const r = anotar(revisarCumplimiento(copia).hallazgos);
      mostrar("contratos.test.ts renombrado a contratos.ts", r);
      expect(r.map((h) => [h.tipo, h.archivo])).toEqual([
        ["guardian-ausente", "test/arquitectura/contratos/contratos.test.ts"],
        ["prueba-sin-sufijo-test", "test/arquitectura/contratos/contratos.ts"],
      ]);
    } finally {
      renameSync(renombrado, original);
    }
  });

  it("4. `continue-on-error: true` en el paso `npm test` de ci.yml → ci-continue-on-error", () => {
    const r = mutar(".github/workflows/ci.yml", "      - name: npm test\n", "      - name: npm test\n        continue-on-error: true\n", "continue-on-error: true en el paso npm test");
    expect(r.map((h) => h.tipo)).toEqual(["ci-continue-on-error"]);
    expect(r[0].archivo).toBe(".github/workflows/ci.yml");
  });

  it("5. el paso `npm test` de ci.yml reemplazado por un echo → ci-sin-paso", () => {
    const r = mutar(".github/workflows/ci.yml", "run: npm test --", "run: echo omitido --", "paso npm test reemplazado");
    expect(r.map((h) => h.tipo)).toEqual(["ci-sin-paso"]);
  });

  it("6. sacar el script `test` de package.json → script-ausente", () => {
    const r = mutar("package.json", '    "test": "vitest run",\n', "", "script test quitado de package.json");
    expect(r.map((h) => h.tipo)).toEqual(["script-ausente"]);
    expect(r[0].archivo).toBe("package.json");
  });

  it("7. un `.only` en un guardián adicional y `allowOnly: true` en vitest.config.ts", () => {
    const r1 = mutar("test/arquitectura/caracterizaciones-congeladas.test.ts", '  it("cada entrada está completa', '  it.only("cada entrada está completa', "it.only en caracterizaciones-congeladas.test.ts");
    expect(r1.map((h) => h.tipo)).toEqual(["prueba-desactivada"]);
    const r2 = mutar("vitest.config.ts", 'environment: "node",', 'environment: "node",\n    allowOnly: true,', "allowOnly: true en vitest.config.ts");
    expect(r2.map((h) => h.tipo)).toEqual(["vitest-allowonly"]);
  });

  it("8. el manifiesto vacío y los archivos que faltan", () => {
    const vacio = revisarCumplimiento(copia, { contratos: [] });
    expect(vacio.hallazgos.map((h) => h.tipo)).toContain("manifiesto-vacio");
    const sinNada = mkdtempSync(join(tmpdir(), "cumplimiento-vacia-"));
    try {
      const r = anotar(revisarCumplimiento(sinNada).hallazgos);
      expect(r.filter((h) => h.tipo === "archivo-ausente").map((h) => h.archivo).sort()).toEqual([".github/workflows/ci.yml", "package.json", "vitest.config.ts"]);
    } finally {
      rmSync(sinNada, { recursive: true, force: true });
    }
  });

  it("la copia queda como el repo (nada de las mutaciones llegó al repo real)", () => {
    expect(revisarCumplimiento(copia).hallazgos).toEqual([]);
    expect(revisarCumplimiento(RAIZ_DEL_REPO).hallazgos).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Meta-test: todo tipo de hallazgo tiene un caso rojo
// ---------------------------------------------------------------------------------------------------------------------------------

describe("meta-test", () => {
  it("cada tipo de hallazgo de cumplimiento lo produce algún caso rojo de este archivo", () => {
    expect(TIPOS_DE_CUMPLIMIENTO.filter((t) => !vistos.has(t))).toEqual([]);
  });
});
