// Mutation testing (Task #41, hallazgo post-cierre 2026-09-28): automatiza lo que hasta ahora se hacía a mano en esta sesión —
// mutar una línea a propósito (comentar un chequeo, poner `&& false`), correr los tests, confirmar que algo falla, revertir.
// Stryker hace eso mismo para cada línea de los archivos acotados de abajo y reporta las mutaciones "sobrevivientes": código que
// se ejecutó (coverage lo vería en verde) pero que ningún test detectaría si se rompiera de verdad.
//
// NO forma parte del gate de 7 comandos: la suite corre contra Postgres real, sin mocks, `fileParallelism: false` — una corrida
// completa ya tarda ~300s, y Stryker repite esa corrida (acotada a los tests relevantes) por cada mutante. Es una auditoría
// PERIÓDICA/MANUAL (`npm run mutacion`), acotada a propósito a `casos-de-uso/` y `persistencia/` (server/), que es donde vive la
// lógica de negocio con ramas de error/reintento/idempotencia — ni la UI ni core puro entran acá.
//
// Mismo criterio de rollout gradual que knip (K1 informativo → K3 obligatorio): esto arranca informativo. Si con el tiempo se
// decide que corra en CI, hace falta acotar aún más el `mutate` (por dominio, o solo los archivos tocados en el PR) para que sea
// viable en tiempo.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: "npm",
  testRunner: "vitest",
  reporters: ["html", "clear-text", "progress"],
  coverageAnalysis: "perTest",
  mutate: ["src/server/actions/**/casos-de-uso/**/*.ts", "src/server/persistencia/**/*.ts", "!src/server/**/*.test.ts"],
  vitest: {
    configFile: "vitest.config.ts",
  },
  // La suite entera es lenta (Postgres real); acotar el timeout evita que un mutante que cuelga (ej. un loop infinito
  // introducido por la propia mutación) trabe toda la corrida.
  timeoutMS: 60000,
};

export default config;
