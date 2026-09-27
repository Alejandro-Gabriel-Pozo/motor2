/**
 * Fronteras entre módulos/capas de motor2 (Task #41, Fase A3). Se corre con `npm run arquitectura`
 * (`depcruise src --config .dependency-cruiser.cjs`) y es parte obligatoria del gate de verificación.
 *
 * Todas las reglas van con severidad "error". Las excepciones NO van acá: viven en `.dependency-cruiser-excepciones.cjs`,
 * una lista por regla y cada entrada con su motivo; `test/arquitectura/dependencias.test.ts` revisa que cada excepción siga
 * haciendo falta (y que no falte ninguna). No se usa el baseline propio de dependency-cruiser (`--ignore-known` /
 * `knownViolations`): no lleva motivo y no avisa cuando una excepción sobra.
 *
 * Capas: `src/core/` (dominio) no conoce a nadie de arriba; `src/app/` + `src/components/` (UI) no tocan Prisma en runtime;
 * `src/server/actions/` (escrituras), `src/server/consultas/` (lecturas, Fase D) y `src/server/persistencia/` (Fase C/D)
 * no se mezclan entre sí salvo actions → persistencia. `server/consultas/` existe desde la Fase D1 (piloto: catalogo/productos.ts);
 * `server/persistencia/` todavía no: su regla queda preparada para cuando exista.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- dependency-cruiser carga esta config como CommonJS (.cjs): `require` es la forma nativa de traer el archivo de excepciones.
const EXCEPCIONES = require("./.dependency-cruiser-excepciones.cjs");

/** Ruta literal (con `/`) → expresión regular anclada que matchea ESE archivo y nada más. */
function rutaExacta(ruta) {
  return `^${ruta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

function excepcionesDe(regla) {
  return (EXCEPCIONES[regla] ?? []).map((e) => rutaExacta(e.ruta));
}

/**
 * Dominios de `src/core/` que ya exponen una fachada `public.ts` (y opcionalmente `public-servidor.ts`): fuera del propio
 * dominio (resto de core/, server/consultas/, server/persistencia/) solo se puede importar esa fachada. ARRANCA VACÍA a
 * propósito: hoy no bloquea nada; la Fase C la va llenando dominio por dominio, a medida que cada uno tiene su `public.ts`.
 */
const DOMINIOS_CON_PUBLIC = [];

const reglasSinInternalsDeOtroDominio = DOMINIOS_CON_PUBLIC.map((dominio) => ({
  name: "sin-internals-de-otro-dominio",
  comment: `Fuera de core/${dominio}/ solo se importa su fachada (core/${dominio}/public.ts o public-servidor.ts), nunca sus archivos internos.`,
  severity: "error",
  from: { path: `^src/(core/(?!${dominio}/)|server/consultas/|server/persistencia/)` },
  to: { path: `^src/core/${dominio}/`, pathNot: `^src/core/${dominio}/public(-servidor)?\\.ts$` },
}));

/**
 * Todos los archivos que forman los ciclos exceptuados (ver `sin-ciclos` más abajo), en UNA sola expresión regular: a
 * diferencia de `from.path`/`to.path`, dependency-cruiser 18 no normaliza un array en `to.via.pathNot` (lo pasaría a
 * `new RegExp` como "a,b" y no matchearía nada — verificado el 2026-09-27).
 */
const ARCHIVOS_EN_CICLOS_CONOCIDOS = (EXCEPCIONES["sin-ciclos"] ?? []).flatMap((e) => e.ciclo.map(rutaExacta)).join("|");

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-sin-capas-superiores",
      comment: "src/core/ (dominio) no importa de app/, components/ ni server/ — ni siquiera con `import type`.",
      severity: "error",
      from: { path: "^src/core/" },
      to: { path: "^src/(app|components|server)/" },
    },
    {
      name: "core-sin-react-next",
      comment: "src/core/ no depende de React ni de Next.js. Excepciones (adaptador de sesión del pedido): .dependency-cruiser-excepciones.cjs.",
      severity: "error",
      from: { path: "^src/core/", pathNot: excepcionesDe("core-sin-react-next") },
      to: { path: "^node_modules/(@types/)?(react|react-dom|next)/" },
    },
    {
      name: "ui-sin-prisma",
      comment:
        "app/ y components/ no usan Prisma en runtime (ni src/lib/db.ts ni @prisma/client); `import type` sí se permite. Excepciones (PENDIENTES_DE_MIGRAR, Fase D): .dependency-cruiser-excepciones.cjs.",
      severity: "error",
      from: { path: "^src/(app|components)/", pathNot: excepcionesDe("ui-sin-prisma") },
      to: { path: ["^src/lib/db\\.ts$", "^node_modules/(@prisma/client|\\.prisma/client)/"], dependencyTypesNot: ["type-only"] },
    },
    {
      name: "acciones-sin-ui",
      comment: "server/actions/ no importa de la UI (app/, components/) ni de server/consultas/. A server/persistencia/ solo llegan los casos de uso (ver persistencia-capa).",
      severity: "error",
      from: { path: "^src/server/actions/" },
      to: { path: ["^src/(app|components)/", "^src/server/consultas/"] },
    },
    {
      name: "consultas-capa",
      comment: "server/consultas/ (lecturas) no importa de la UI, de server/actions/ ni de server/persistencia/.",
      severity: "error",
      from: { path: "^src/server/consultas/" },
      to: { path: ["^src/(app|components)/", "^src/server/actions/", "^src/server/persistencia/"] },
    },
    {
      name: "persistencia-capa",
      comment: "server/persistencia/ no importa de la UI, de server/actions/ ni de server/consultas/.",
      severity: "error",
      from: { path: "^src/server/persistencia/" },
      to: { path: ["^src/(app|components)/", "^src/server/actions/", "^src/server/consultas/"] },
    },
    {
      name: "persistencia-capa",
      comment: "Solo server/actions/ (y la propia persistencia) puede importar server/persistencia/.",
      severity: "error",
      from: { pathNot: ["^src/server/actions/", "^src/server/persistencia/"] },
      to: { path: "^src/server/persistencia/" },
    },
    ...reglasSinInternalsDeOtroDominio,
    {
      name: "publico-puro",
      comment: "La fachada pública de un dominio (core/X/public.ts) no puede alcanzar src/lib/db.ts, ni directa ni transitivamente.",
      severity: "error",
      from: { path: "^src/core/[^/]+/public\\.ts$" },
      to: { path: "^src/lib/db\\.ts$", reachable: true },
    },
    {
      name: "sin-ciclos",
      comment:
        "Sin dependencias circulares entre archivos (incluye las de solo tipos). Ciclos preexistentes exceptuados: .dependency-cruiser-excepciones.cjs.",
      severity: "error",
      from: {},
      // `via.pathNot`: el ciclo se marca si pasa por ALGÚN archivo fuera de los ciclos exceptuados — o sea, solo se deja
      // pasar un ciclo formado exclusivamente por archivos exceptuados. dependencias.test.ts exige además que el conjunto
      // de ciclos reales sea EXACTAMENTE el de la lista.
      to: ARCHIVOS_EN_CICLOS_CONOCIDOS.length > 0 ? { circular: true, via: { pathNot: ARCHIVOS_EN_CICLOS_CONOCIDOS } } : { circular: true },
    },
    {
      name: "no-non-package-json",
      comment:
        "Todo paquete importado tiene que estar declarado en package.json (dependencies o devDependencies): cierra la puerta a usar una dependencia transitiva (ej. zod, fast-check) sin declararla.",
      severity: "error",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    // IMPRESCINDIBLE: sin esto dependency-cruiser no ve los `import type` (el caso de A1, ui-config.ts, era de solo tipo).
    tsPreCompilationDeps: true,
    // `src/` más los paquetes de node_modules COMO HOJAS (doNotFollow): si node_modules quedara afuera de includeOnly/exclude,
    // dependency-cruiser descartaría toda dependencia hacia un paquete y las reglas core-sin-react-next, ui-sin-prisma
    // (@prisma/client) y no-non-package-json nunca verían nada (verificado el 2026-09-27).
    includeOnly: ["^src/", "^node_modules/"],
    exclude: { path: ["^\\.next/"] },
    doNotFollow: { path: ["^node_modules/"] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
