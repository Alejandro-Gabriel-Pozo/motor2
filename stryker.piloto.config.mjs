// PILOTO de mutación sobre el dinero del núcleo (`npm run mutacion:piloto`). Mide cuánto del comportamiento de `src/core/moneda.ts`
// detectan de verdad los tests: Stryker cambia el código a propósito (un `>` por `>=`, un redondeo por otro, una guarda borrada) y
// corre los tests; un mutante que ningún test nota «sobrevive» y señala una regla de dinero sin verificar.
//
// NO forma parte del gate de 8 comandos (AGENTS.md). Es una medición aparte, manual y PURA: no toca Postgres ni Prisma. Los tests de
// abajo son los que ejercitan `moneda.ts` sin base de datos; `testFiles` los fija a propósito (sin eso la corrida inicial ejecutaría la
// suite entera, que necesita Postgres) y además demuestra que el módulo se defiende SOLO con sus propios tests. El `stryker.config.mjs`
// de la raíz (`npm run mutacion`) es otra cosa: la auditoría de `server/`, contra Postgres real.
//
// Qué hace cada opción (verificadas contra `node_modules/@stryker-mutator/core/schema/stryker-schema.json` y el `vitest-runner` 10.0.0):
//   - `testRunner: "vitest"` con la `vitest.config.ts` del repo (`fileParallelism: false`, alias de `server-only`/`next/headers`; sin
//     `setupFiles` ni base). `vitest.related: false`: no se usa el modo `--related` (corre solo lo fijado en `testFiles`).
//   - `coverageAnalysis: "perTest"`: el runner de Vitest lo soporta; cada mutante corre solo los tests que lo cubren.
//   - `concurrency: 2`: baja, para no competir con otros procesos del equipo (la corrida es corta igual).
//   - reportes `clear-text` + `json` + `html` en `reports/mutation/` (la carpeta `/reports` y `.stryker-tmp/` están en `.gitignore`).
//
// CONTRATO DE LA MEDICIÓN (piloto sobre `src/core/moneda.ts`, StrykerJS 10.0.0 + Vitest 4.1.11 + Node 22; 4 CPU, concurrency 2):
//   - comando:        `npm run mutacion:piloto` (reportes en `reports/mutation/`: `mutation.html`, `mutation.json`).
//   - tiempo medido:  ~50 s con 130 mutantes (~0,4 s por mutante) antes de reforzar los tests; ~70 s después (el mutante estático, uno
//                     solo, recarga todo el entorno y pesa ~20 s). La corrida inicial (sin mutar) tarda ~5 s.
//   - puntaje:        74,62 % antes (97 muertos, 19 sobrevivientes, 14 sin cobertura) → 90,00 % después (117 muertos, 13 sobrevivientes,
//                     0 sin cobertura). Los 13 restantes son EQUIVALENTES (no cambian el comportamiento observable) o el mutante
//                     estático de abajo; el máximo alcanzable sin tocar el código de `moneda.ts` es 118/130 = 90,77 %.
//   - umbral:         `thresholds.break = 90`: la corrida sale con código distinto de 0 si el puntaje baja de 90 %. Es el valor medido
//                     (no un deseo): con 12 equivalentes que no se pueden matar, 90 % es el techo práctico de este archivo.
//   - trinquete:      el puntaje de cada archivo mutado no puede bajar respecto del último medido. Un mutante nuevo que sobrevive se mata
//                     con un test de valores concretos de dinero (redondeo de empates, negativos, ceros, bordes de centavos) o se anota
//                     como equivalente, con su razón, en esta lista, y recién entonces se baja el `break`. Si se edita `moneda.ts` cambia
//                     la cantidad de mutantes: se vuelve a medir y se actualizan estos números en el mismo commit.
//   - equivalentes conocidos (todos en `moneda.ts`; ninguno se mata con un test porque el código mutado da el mismo resultado):
//       · `redondearMoneda`: la guarda `!Number.isFinite(n)` (con NaN/±Infinity, `new D(n)` ya los devuelve igual) y el atajo
//         `Number.isInteger(n)` (el camino por Decimal da el mismo entero y normaliza -0 igual): solo son optimizaciones.
//       · `importeDeLinea`: la guarda de no finitos y el atajo de enteros seguros (`Number.isInteger` / `isSafeInteger`, 8 mutantes): el
//         producto en float de dos enteros, o con un dato no finito, es igual al exacto en decimal redondeado al double más cercano.
//       · `repartirImporte`: `p > 0` → `p >= 0` (un peso 0 sigue valiendo 0) y el desempate `a.i - b.i` → `a.i + b.i` (el motor de JS
//         solo compara un elemento con otro de índice menor; con `sort` de V8 el resultado es el mismo en 70 a 1000 elementos).
//       · mutante ESTÁTICO `Decimal.clone({precision: 40, ...})` → `Decimal.clone({})` (precisión 20): Stryker lo da por sobreviviente,
//         pero NO es equivalente: los 3 tests de «precisión de 40 dígitos» de `test/core/moneda-mutacion.test.ts` lo matan a mano
//         (`__STRYKER_ACTIVE_MUTANT__=0` en el sandbox, o editando la línea). El runner de Vitest no activa bien los mutantes
//         estáticos en este entorno; al extender a `src/core`, tratar los estáticos como verificación manual (o `ignoreStatic`).
//   - extensión:      el mismo esquema para `src/core` (puro, sin Prisma; 373 archivos, ~30.000 líneas): por dominio (`mutate` +
//                     `testFiles` de ese dominio), un `break` por dominio igual a su puntaje medido, y `incremental` para correr solo lo
//                     que cambió. Estimación: ~0,9 mutantes por línea → 10.000 a 26.000 mutantes; a ~0,4 s por mutante, de 1,5 a 3 horas en
//                     total con concurrency 2 (la mitad con 4): se corre por dominio, no entero, y NUNCA en el gate.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: "npm",
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.config.ts",
    related: false,
  },
  coverageAnalysis: "perTest",
  mutate: ["src/core/moneda.ts"],
  testFiles: [
    "test/core/moneda.test.ts",
    "test/core/moneda.propiedades.test.ts",
    "test/core/moneda-equivalencia-prisma.test.ts",
    "test/core/precio-con-descuento.test.ts",
    "test/core/porcentaje-de-importe.test.ts",
    "test/core/moneda-mutacion.test.ts",
  ],
  concurrency: 2,
  timeoutMS: 30000,
  // `high`/`low` solo colorean el reporte; `break` (ver CONTRATO arriba) hace fallar la corrida si el puntaje baja de 90.
  thresholds: { high: 95, low: 90, break: 90 },
  reporters: ["clear-text", "progress", "json", "html"],
  htmlReporter: { fileName: "reports/mutation/mutation.html" },
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
};

export default config;
