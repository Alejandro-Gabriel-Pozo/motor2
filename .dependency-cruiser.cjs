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

/**
 * Lo único de auth/permisos/server que la carta pública (sin sesión) puede ALCANZAR, directa o transitivamente (ADR-006 + ADR-007): la
 * base por empresa y su verificación de rol (`core/auth/base.ts`, `rol-de-ejecucion.ts`) y el catálogo de claves de permiso
 * (`core/permisos/acciones.ts`, `capacidades-sucursal.ts`: solo tipos y constantes). Lista CERRADA: un archivo nuevo de `core/auth`,
 * `core/permisos` o `server` que la carta empiece a alcanzar (la sesión, el gate, una Server Action) rompe `carta-publica-alcance`.
 */
const ALCANCE_CARTA_PUBLICA = [
  "^src/core/auth/(base|rol-de-ejecucion)\\.ts$",
  "^src/core/permisos/(acciones|capacidades-sucursal)\\.ts$",
];

/** Ruta literal (con `/`) → expresión regular anclada que matchea ESE archivo y nada más. */
function rutaExacta(ruta) {
  return `^${ruta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

/** Las Server Actions ya migradas a caso de uso (`accion-migrada-sin-orquestacion`), como UNA expresión regular (ver el comentario de ARCHIVOS_EN_CICLOS_CONOCIDOS). */
const ACCIONES_MIGRADAS = (EXCEPCIONES.ACCIONES_CON_CASO_DE_USO ?? []).map((e) => rutaExacta(e.ruta)).join("|") || "^$^";

function excepcionesDe(regla) {
  return (EXCEPCIONES[regla] ?? []).map((e) => rutaExacta(e.ruta));
}

/** Dominios de negocio e infraestructura transversal de `src/core/`: ver `.dependency-cruiser-dominios.cjs` (cada carpeta en exactamente una lista; lo verifica `dominios-clasificados.test.ts`). */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- misma razón que EXCEPCIONES: dependency-cruiser carga esta config como CommonJS.
const { DOMINIOS_DE_NEGOCIO } = require("./.dependency-cruiser-dominios.cjs");

/**
 * Dominios de negocio que TODAVÍA no tienen su fachada `public.ts`/`public-servidor.ts` — excepción con motivo (2026-09-28,
 * invertido desde un allowlist `DOMINIOS_CON_PUBLIC`: ese esquema dejaba a `pos`/`stock`/`compras`/`carta` sin NINGUNA protección
 * simplemente porque nadie se acordó de sumarlos — el mismo problema, en el fondo, que el test de idempotencia I3 encontrado el
 * mismo día). Con esta lista invertida, el default es PROTEGER: un dominio de negocio nuevo que se agregue a
 * `DOMINIOS_DE_NEGOCIO` y no tenga fachada todavía HACE FALLAR el gate hasta que se decida explícitamente construirle la fachada
 * o sumarlo acá con motivo — no al revés.
 *
 * Desde la Fase 2 de pureza (2026-10-06) la lista está VACÍA: todos los dominios de negocio tienen su fachada (`catalogo`, `movimientos`, `reportes`, `pos`,
 * `stock`, `compras`; `carta` y `fiscal` desde antes). Se conserva como el lugar donde se declara, con motivo, un dominio nuevo que todavía no la tiene.
 */
const DOMINIOS_SIN_PUBLIC_TODAVIA = {};

const reglasSinInternalsDeOtroDominio = DOMINIOS_DE_NEGOCIO.filter((dominio) => !(dominio in DOMINIOS_SIN_PUBLIC_TODAVIA)).map((dominio) => ({
  name: "sin-internals-de-otro-dominio",
  comment: `Fuera de core/${dominio}/ solo se importa su fachada (core/${dominio}/public.ts o public-servidor.ts), nunca sus archivos internos. Las Server Actions de OTRO dominio también (las del propio dominio, server/actions/${dominio}/, sí pueden usar su core).`,
  severity: "error",
  from: { path: `^src/(core/(?!${dominio}/)|server/actions/(?!${dominio}/)|server/(consultas|lecturas|persistencia)/)` },
  to: { path: `^src/core/${dominio}/`, pathNot: `^src/core/${dominio}/public(-servidor)?\\.ts$` },
}));

/** `ui-sin-internals-de-dominio` (Pureza Fase 2, paso 2.3): la UI importa un dominio de negocio SOLO por su fachada. */
const reglaUiSinInternalsDeDominio = {
  name: "ui-sin-internals-de-dominio",
  comment:
    "app/ y components/ importan de un dominio de negocio (core/<dominio>/) solo su fachada (public.ts o public-servidor.ts), nunca un archivo interno: así el dominio puede mover su código sin tocar 86 pantallas. Un componente de cliente usa public.ts; public-servidor.ts es para páginas y componentes de servidor. Excepciones (solo se achican): .dependency-cruiser-excepciones.cjs.",
  severity: "error",
  from: { path: "^src/(app|components)/", pathNot: excepcionesDe("ui-sin-internals-de-dominio") },
  to: { path: `^src/core/(${DOMINIOS_DE_NEGOCIO.join("|")})/`, pathNot: "^src/core/[^/]+/public(-servidor)?\.ts$" },
};

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
      name: "db-solo-desde-auth-y-carta-publica",
      comment:
        "Solo core/auth, lib/auth.ts y la resolución pública de la carta importan src/lib/db.ts (ADR-007 N2): el resto recibe la base del contexto (ctx.db / ctx.transaccion) o por parámetro (db: Db). Lista con motivo: .dependency-cruiser-excepciones.cjs.",
      severity: "error",
      from: { path: "^src/", pathNot: excepcionesDe("db-solo-desde-auth-y-carta-publica") },
      to: { path: "^src/lib/db\\.ts$" },
    },
    {
      name: "base-solo-desde-lista",
      comment:
        "Solo los archivos de IMPORTADORES_DE_BASE importan core/auth/base.ts (dbDeEmpresa/dbDeUsuario/baseDeEmpresa/baseDelContexto): el resto recibe la base del contexto. Lista con motivo: .dependency-cruiser-excepciones.cjs.",
      severity: "error",
      from: { path: "^src/", pathNot: excepcionesDe("base-solo-desde-lista") },
      to: { path: "^src/core/auth/base\.ts$" },
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
      name: "lecturas-capa",
      comment:
        "server/lecturas/ (lecturas compartidas entre pantalla y escritura, ADR-026) no importa de la UI, de server/actions/, de server/consultas/ ni de server/persistencia/: una lectura compartida no puede depender de quien la usa.",
      severity: "error",
      from: { path: "^src/server/lecturas/" },
      to: { path: ["^src/(app|components)/", "^src/server/actions/", "^src/server/consultas/", "^src/server/persistencia/"] },
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
        "Una Server Action ya migrada a caso de uso (ACCIONES_CON_CASO_DE_USO, .dependency-cruiser-excepciones.cjs) no usa en runtime src/lib/db.ts, @prisma/client, el reintento/transacción (con-reintento, reintentar), la idempotencia I3 ni la auditoría: todo eso pasa por su caso de uso. `import type` sí se permite. Incluye la fachada core/movimientos/public-servidor.ts (C2), que reexporta reintento, transacción e idempotencia: si no, la regla se esquivaría importándolos por ahí.",
      severity: "error",
      from: { path: ACCIONES_MIGRADAS },
      to: {
        path: [
          "^src/lib/db\\.ts$",
          "^node_modules/(@prisma/client|\\.prisma/client)/",
          "^src/core/movimientos/(con-reintento|reintentar|idempotencia|public-servidor)\\.ts$",
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
    reglaUiSinInternalsDeDominio,
    {
      name: "publico-puro",
      comment: "La fachada pública de un dominio (core/X/public.ts) no puede alcanzar src/lib/db.ts, ni directa ni transitivamente.",
      severity: "error",
      from: { path: "^src/core/[^/]+/public\\.ts$" },
      to: { path: "^src/lib/db\\.ts$", reachable: true },
    },
    {
      name: "casos-de-uso-no-cookies",
      comment:
        "Fase 0.4 del checklist de multi-tenancy (Downloads/Motor 2/motor2-multitenancy-checklist (1).md): un caso de uso " +
        "(server/actions/<dominio>/casos-de-uso/) nunca lee cookies()/next/headers directo — solo el resolvedor de contexto " +
        "(core/auth/contexto.ts, ya excepción documentada de core-sin-react-next) lo hace. Sin violaciones hoy: cierra la puerta " +
        "a que un caso de uso nuevo empiece a leer sesión por su cuenta en vez de recibirla como parámetro.",
      severity: "error",
      from: { path: CASOS_DE_USO },
      to: { path: "^node_modules/next/" },
    },
    {
      name: "carta-publica-aislada",
      comment:
        "ADR-006, Fase 3: la carta pública nueva (sin sesión) no puede alcanzar auth, permisos ni Server Actions — es " +
        "la disciplina de código que reemplaza al boundary HTTP/token que tenía la app externa. Lee por " +
        "core/carta/public(-servidor).ts como cualquier otro consumidor externo al dominio.",
      severity: "error",
      from: { path: "^src/(app/\\(carta-publica\\)/|components/carta-publica/)" },
      to: { path: "^src/(core/auth/|server/actions/|core/permisos/)" },
    },
    {
      name: "carta-publica-alcance",
      comment:
        "La carta pública no alcanza —ni siquiera transitivamente— sesión, permisos, Server Actions ni lib/auth.ts, salvo lo de ALCANCE_CARTA_PUBLICA (lista cerrada, arriba). `carta-publica-aislada` solo mira imports directos: un helper intermedio los esquivaría.",
      severity: "error",
      from: { path: "^src/(app/\\(carta-publica\\)/|components/carta-publica/|core/carta/publica-sin-sesion\\.ts$)" },
      to: { path: "^src/(core/auth/|core/permisos/|server/|lib/auth\\.ts$)", pathNot: ALCANCE_CARTA_PUBLICA, reachable: true },
    },
    {
      name: "publica-sin-sesion-solo-desde-carta-publica",
      comment:
        "core/carta/publica-sin-sesion.ts elige el cliente de base SIN sesión (la empresa sale de la URL): solo lo importan las páginas de app/(carta-publica)/. Importarlo desde la app con sesión o un caso de uso saltearía el contexto de usuario.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/(app/\\(carta-publica\\)/|core/carta/publica-sin-sesion\\.ts$)" },
      to: { path: "^src/core/carta/publica-sin-sesion\\.ts$" },
    },
    {
      name: "carta-admin-sin-rutas-de-catalogo",
      comment:
        "ADR-006 (docs/adr/ADR-006-carta-como-modulo-interno.md): la carta es su propio módulo, separado de catálogo " +
        "(antes anidada en app/(app)/catalogo/carta sin motivo claro, pese a tener su propio permiso `accion: \"carta\"`). " +
        "Fija la separación: una pantalla de app/(app)/carta/ no importa de app/(app)/catalogo/.",
      severity: "error",
      from: { path: "^src/app/\\(app\\)/carta/" },
      to: { path: "^src/app/\\(app\\)/catalogo/" },
    },
    {
      name: "politica-solo-desde-plataforma",
      comment:
        "Add-on C2 (ADR-008/ADR-010): la política de plataforma de una empresa (permisosEditables, dosPaneles) solo la cambia la plataforma, " +
        "por scripts/politica-empresa.ts (fuera de src/). Ningún archivo de src/ importa core/features/empresa/cambiar-politica-empresa.ts: " +
        "ni una Server Action, ni una pantalla, ni otro caso de uso. Complemento: test/arquitectura/politica-de-empresa-solo-plataforma.test.ts.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/core/features/empresa/cambiar-politica-empresa\\.ts$" },
      to: { path: "^src/core/features/empresa/cambiar-politica-empresa\\.ts$" },
    },
    {
      name: "modulos-solo-desde-plataforma",
      comment:
        "Bloque 5A, P9 (ADR-011/ADR-012): el registro de módulos de una empresa solo lo cambia la plataforma, por scripts/modulos-empresa.ts (fuera de src/). " +
        "Ningún archivo de src/ importa core/features/empresa/cambiar-modulos-de-empresa.ts: ni una Server Action, ni una pantalla, ni otro caso de uso. " +
        "La base lo exige además (solo el dueño y motor2_plataforma escriben ModuloEmpresa).",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/core/features/empresa/cambiar-modulos-de-empresa\\.ts$" },
      to: { path: "^src/core/features/empresa/cambiar-modulos-de-empresa\\.ts$" },
    },
    {
      name: "app-sin-consola-de-plataforma",
      comment:
        "ADR-012/ADR-019: la consola de plataforma (plataforma/) es otra aplicación, con su propio proyecto de Vercel. Nada de src/ la importa.",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^plataforma/" },
    },
    {
      name: "consola-sin-lo-interno-de-la-app",
      comment:
        "ADR-012/ADR-019: la consola de plataforma solo usa del núcleo lo PURO y lo propio (core/plataforma, core/correo, core/seguridad, la cookie de https y el reporte de errores). Nunca alcanza, ni directa ni transitivamente, la base de la aplicación " +
        "(lib/db.ts, lib/auth.ts, core/auth/{base,contexto,session}), su validación de entorno (env.ts), ni server/, app/ o components/: " +
        "su única conexión es la del rol motor2_plataforma (plataforma/src/db.ts), y que la aplicación abra la puerta de una empresa desde la consola es justo lo que el diseño prohíbe.",
      severity: "error",
      from: { path: "^plataforma/" },
      to: { path: ["^src/lib/(db|auth)\\.ts$", "^src/env\\.ts$", "^src/core/auth/(base|contexto|session)\\.ts$", "^src/(server|app|components)/"], reachable: true },
    },
    {
      name: "core-plataforma-solo-desde-la-consola",
      comment:
        "ADR-019: el login de la consola (códigos, TOTP, sesión) solo lo importa plataforma/. Única excepción: core/plataforma/email-reservado.ts, que crear-empresa usa para rechazar el alta de un gerente con el email de un administrador de plataforma.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/core/plataforma/" },
      to: { path: "^src/core/plataforma/", pathNot: "^src/core/plataforma/email-reservado\\.ts$" },
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
    // `plataforma/` (la consola, ADR-019) también se recorre: sus fronteras son las reglas `consola-*` de arriba.
    includeOnly: ["^src/", "^plataforma/", "^node_modules/"],
    exclude: { path: ["^\\.next/", "^plataforma/\\.next/", "^plataforma/node_modules/"] },
    doNotFollow: { path: ["^node_modules/"] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
