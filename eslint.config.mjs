import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
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
