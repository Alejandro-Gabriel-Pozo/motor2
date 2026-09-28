import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Type-aware linting (Task #13, backlog post-cierre de Task #41, 2026-09-28, docs/pendientes-sesion-2026-09-27.md §13):
  // `eslint-config-next/typescript` usa `typescript-eslint.configs.recommended` (SIN información de tipos — sin esto,
  // `no-floating-promises`/`no-misused-promises` no tienen forma de saber qué expresión devuelve una Promise). Se habilita
  // `projectService` (no `project: [...]` a mano — más simple, usa el mismo descubrimiento de proyecto que el propio
  // `tsserver`) y SOLO estas 2 reglas, no todo `recommendedTypeChecked` (eso agregaría muchas más reglas de golpe, un blast
  // radius mayor al que pedía el pendiente). Medido en la práctica: 9 violaciones en 7 archivos, todas builds/eventos
  // "fire-and-forget" ya seguros (con manejo de error propio, `leer()`/try-catch) sin marcar explícito — corregidas con
  // `void` (o el IIFE `void (async () => {...})()` cuando el callback tiene que ser sync, ej. `setTimeout`/`onClick`),
  // nunca bugs reales encontrados.
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // test/e2e/ y test/e2e-demo/ no son código React — son fixtures de Playwright, cuyo API
    // (test.extend({ fixture: async ({}, use) => ... })) usa un parámetro
    // literal llamado `use` que react-hooks/rules-of-hooks confunde con un
    // Hook de React por el nombre, sin relación real con React.
    files: ["test/e2e/**/*.ts", "test/e2e-demo/**/*.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);

export default eslintConfig;
