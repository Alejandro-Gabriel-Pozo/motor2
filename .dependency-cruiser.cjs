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
 * `src/server/actions/` (escrituras), `src/server/consultas/` (lecturas, Fase D) y `src/server/persistencia/` no se mezclan
 * entre sí salvo casos de uso → persistencia. `server/consultas/` existe desde la Fase D1 (piloto: catalogo/productos.ts);
 * `server/persistencia/` y `server/actions/<dominio>/casos-de-uso/` desde la Fase M (piloto: compras — anular y corregir).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- dependency-cruiser carga esta config como CommonJS (.cjs): `require` es la forma nativa de traer el archivo de excepciones.
const EXCEPCIONES = require("./.dependency-cruiser-excepciones.cjs");

/** Los casos de uso de mutaciones (Task #41, Fase M): `src/server/actions/<dominio>/casos-de-uso/<verbo>.ts`. */
const CASOS_DE_USO = "^src/server/actions/[^/]+/casos-de-uso/";

/** Ruta literal (con `/`) → expresión regular anclada que matchea ESE archivo y nada más. */
function rutaExacta(ruta) {
  return `^${ruta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

/** Las Server Actions ya migradas a caso de uso (`accion-migrada-sin-orquestacion`), como UNA expresión regular (ver el comentario de ARCHIVOS_EN_CICLOS_CONOCIDOS). */
const ACCIONES_MIGRADAS = (EXCEPCIONES.ACCIONES_CON_CASO_DE_USO ?? []).map((e) => rutaExacta(e.ruta)).join("|") || "^$^";

function excepcionesDe(regla) {
  return (EXCEPCIONES[regla] ?? []).map((e) => rutaExacta(e.ruta));
}

/**
 * Dominios de `src/core/` que ya exponen una fachada `public.ts` (y opcionalmente `public-servidor.ts`): fuera del propio
 * dominio (resto de core/, server/consultas/, server/persistencia/) solo se puede importar esa fachada. Arrancó vacía (A3);
 * la Fase C la va llenando dominio por dominio, a medida que cada uno tiene su `public.ts`:
 *  - C1 (piloto): `catalogo` → core/catalogo/public.ts (puro) + core/catalogo/public-servidor.ts (toca la base).
 */
const DOMINIOS_CON_PUBLIC = ["catalogo"];

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
      comment: "server/actions/ no importa de la UI (app/, components/) ni de server/consultas/. A server/persistencia/ solo llegan sus casos de uso (ver persistencia-solo-desde-casos-de-uso).",
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
      name: "persistencia-solo-desde-casos-de-uso",
      comment:
        "Solo un caso de uso (src/server/actions/<dominio>/casos-de-uso/) —y la propia persistencia— importa server/persistencia/: ni una Server Action, ni la UI, ni core/, ni server/consultas/ (Task #41, Fase M; docs/arquitectura-casos-de-uso-2026-09-27.md).",
      severity: "error",
      from: { pathNot: [CASOS_DE_USO, "^src/server/persistencia/"] },
      to: { path: "^src/server/persistencia/" },
    },
    // Dos entradas con el mismo nombre (como las dos de `persistencia-capa`): lo que se prohíbe en runtime (`import type` sí) y lo
    // que se prohíbe del todo.
    {
      name: "accion-migrada-sin-orquestacion",
      comment:
        "Una Server Action ya migrada a caso de uso (ACCIONES_CON_CASO_DE_USO, .dependency-cruiser-excepciones.cjs) no usa en runtime src/lib/db.ts, @prisma/client, el reintento/transacción (con-reintento, reintentar), la idempotencia I3 ni la auditoría: todo eso pasa por su caso de uso. `import type` sí se permite.",
      severity: "error",
      from: { path: ACCIONES_MIGRADAS },
      to: {
        path: [
          "^src/lib/db\\.ts$",
          "^node_modules/(@prisma/client|\\.prisma/client)/",
          "^src/core/movimientos/(con-reintento|reintentar|idempotencia)\\.ts$",
          "^src/core/permisos/auditoria\\.ts$",
        ],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "accion-migrada-sin-orquestacion",
      comment: "Una Server Action ya migrada a caso de uso no importa server/persistencia/ (ni siquiera sus tipos): habla con su caso de uso en comandos y resultados.",
      severity: "error",
      from: { path: ACCIONES_MIGRADAS },
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
