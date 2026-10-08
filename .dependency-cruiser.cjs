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
 * base por empresa y su verificación de rol (`core/auth/base.ts`, `rol-de-ejecucion.ts`), el catálogo de claves de permiso
 * (`core/permisos/acciones.ts`: solo constantes) y las dos reglas PURAS de las capacidades por sucursal (`core/permisos/capacidades-sucursal.ts`: `esCapacidadSiempreHabilitada` y `resolverCapacidad`, sin base), el LECTOR de esas capacidades
 * (`server/acceso/capacidades-sucursal.ts`: `sucursalTieneCapacidad` y `capacidadesDeSucursal`, que leen `CapacidadSucursal` con el `db` que reciben por parámetro; la carta lo alcanza en ejecución por `lecturas/carta` → `precioLocalActivoEn` → `sucursalTieneCapacidad`;
 * salió de `core/permisos` en el bloque 2 de la pieza 5.2 del Hito 5, rama `pureza-integracion`, y es el ÚNICO archivo de `server/acceso` que la carta alcanza: no el gate, ni el menú, ni los módulos, ni la política) y el embudo del
 * precio local (`server/lecturas/catalogo/precio-local.ts`: `precioLocalActivoEn` y `preciosLocalesVigentes`, que la carta llama para mostrar el precio que rige; desde el paso 2 de la pieza 5.2 vive acá y no en `core/catalogo`, y es un archivo de LECTURA que recibe el `db` por parámetro: no importa la sesión, el gate ni ninguna acción). Lista CERRADA: un archivo nuevo
 * de `core/auth`, `core/permisos` o `server` que la carta empiece a alcanzar (la sesión, el gate, una Server Action) rompe `carta-publica-alcance`; que un archivo de la lista deje de alcanzarse o que una entrada nombre una carpeta lo ve `test/arquitectura/dependencias.test.ts`.
 */
const ALCANCE_CARTA_PUBLICA = [
  "^src/core/auth/(base|rol-de-ejecucion)\\.ts$",
  "^src/core/permisos/(acciones|capacidades-sucursal)\\.ts$",
  "^src/server/acceso/capacidades-sucursal\\.ts$",
  "^src/server/lecturas/catalogo/precio-local\\.ts$",
  // Pureza Fase 3 (PR de la carta pública): sus lecturas y el archivo que elige el cliente SIN sesión salieron de `core/carta` a `server/`. Misma lista cerrada, solo
  // cambian las rutas: son EXACTAMENTE los cinco archivos de antes (menu-consulta, descuento-producto-consulta, empresa-carta, publica-consulta, publica-sin-sesion).
  "^src/server/lecturas/carta/(menu|descuentos|empresa|publica)\\.ts$",
  "^src/server/carta-publica/sin-sesion\\.ts$",
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
  // TODO el código fuera de su propio dominio: el núcleo de otro dominio, las acciones de otro dominio, las capas del servidor (consultas, lecturas, persistencia, acceso, adaptadores, carta pública…),
  // `src/lib`, el `proxy`, la configuración (`env.ts`) y la consola de plataforma. La UI (`app/`, `components/`) tiene su propia regla (`ui-sin-internals-de-dominio`, con su lista de excepciones).
  // `next.config.ts` queda afuera de esta regla a propósito: lo carga Node sin los alias de TypeScript, así que no puede importar la fachada (que usa `@/…`); importa los dos archivos hoja de carta.
  from: { path: `^(src/(?!(core/${dominio}|server/actions/${dominio}|app|components)/)|plataforma/src/)` },
  to: { path: `^src/core/${dominio}/`, pathNot: `^src/core/${dominio}/public(-servidor)?\\.ts$` },
}));

/** `ui-sin-internals-de-dominio` (Pureza Fase 2, paso 2.3): la UI importa un dominio de negocio SOLO por su fachada. */
const reglaUiSinInternalsDeDominio = {
  name: "ui-sin-internals-de-dominio",
  comment:
    "app/ y components/ importan de un dominio de negocio (core/<dominio>/) solo su fachada (public.ts o public-servidor.ts), nunca un archivo interno: así el dominio puede mover su código sin tocar 86 pantallas. Un componente de cliente usa public.ts; public-servidor.ts es para páginas y componentes de servidor. Excepciones (solo se achican): .dependency-cruiser-excepciones.cjs.",
  severity: "error",
  from: { path: "^src/(app|components)/", pathNot: excepcionesDe("ui-sin-internals-de-dominio") },
  to: { path: `^src/core/(${DOMINIOS_DE_NEGOCIO.join("|")})/`, pathNot: "^src/core/[^/]+/public(-servidor)?[.]ts$" },
};

/** `paginas-solo-consultas` (Pureza, trabajo 1.12): la UI (páginas, layouts y componentes de `app/` y `components/`) pide los datos a `server/consultas`, no a `server/lecturas` ni a `server/persistencia`. */
const reglaPaginasSoloConsultas = {
  name: "paginas-solo-consultas",
  comment:
    "Una página (page.tsx, layout.tsx) lee por `server/consultas`: `server/lecturas` es la capa de las lecturas COMPARTIDAS entre pantalla y escritura (las importan consultas, persistencia y acciones, ADR-026) y `server/persistencia` es de los casos de uso. Las excepciones, con motivo, en `.dependency-cruiser-excepciones.cjs`.",
  severity: "error",
  from: { path: "^src/(app|components)/", pathNot: excepcionesDe("paginas-solo-consultas") },
  to: { path: "^src/server/(lecturas|persistencia)/" },
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
    reglaPaginasSoloConsultas,
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
      to: { path: "^src/core/auth/base[.]ts$" },
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
      name: "acceso-capa",
      comment:
        "server/acceso/ (el guard de acceso y sus lectores, ADR-011; Pureza Fase 3 tramo B) lee lo que hace falta y le pasa los hechos a la decisión pura de core/permisos: no importa la UI, ni server/actions, consultas, lecturas ni persistencia, ni lib/db, ni Next, ni la sesión (core/auth: contexto, session, ir-al-login; solo tipos), ni la base por empresa (core/auth/base). El acceso recibe ids y un `db`: nunca lee cookies ni la sesión.",
      severity: "error",
      from: { path: "^src/server/acceso/" },
      to: {
        path: [
          "^src/(app|components)/",
          "^src/server/(actions|consultas|lecturas|persistencia)/",
          "^src/lib/db\\.ts$",
          "^node_modules/next/",
          "^src/core/auth/(base|contexto|session|ir-al-login)\\.ts$",
        ],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "sesion-capa",
      comment:
        "server/sesion/ (el login previo al contexto de empresa: gate de signIn, invitación por token, vinculación de la cuenta de Google; Hito 3, B3) es una capa de ABAJO: la usan lib/auth.ts, las pantallas y acciones de la invitación y los casos de uso de aceptar, nunca al revés. No importa la UI, ni server/actions (las Server Actions ni los casos de uso), consultas, lecturas, persistencia ni el guard (server/acceso: el guard de quien otorgó entra por parámetro), ni Next (recibe el token ya leído de la cookie). Lista cerrada de archivos: test/arquitectura/server-sesion.test.ts.",
      severity: "error",
      from: { path: "^src/server/sesion/" },
      to: { path: ["^src/(app|components)/", "^src/server/(actions|consultas|lecturas|persistencia|acceso)/", "^node_modules/next/"] },
    },
    // Dos entradas con el mismo nombre (como las de `persistencia-capa`): lo que la capa NO puede importar y quién NO puede importar la capa.
    {
      name: "auditoria-capa",
      comment:
        "server/auditoria/ (el escritor de la auditoría, `registrarCambioAuditado`; Hito 5, pieza 5.4, B3 y B5) es una capa de ABAJO: recibe un `db` y escribe una fila, nada más. No importa la UI, ni lib/ (ni lib/db: la base entra por parámetro), ni lo demás de server/ (acciones, consultas, lecturas, persistencia, acceso, sesión, carta pública, adaptadores, operaciones de plataforma), ni Next, ni la sesión (core/auth). Solo puede depender de core/ (la forma de un cambio y la fila). Lista cerrada de archivos: test/arquitectura/server-auditoria.test.ts.",
      severity: "error",
      from: { path: "^src/server/auditoria/" },
      to: {
        path: [
          "^src/(app|components|lib)/",
          "^src/server/(actions|consultas|lecturas|persistencia|acceso|sesion|carta-publica|adaptadores|operaciones-de-plataforma)/",
          "^node_modules/next/",
          "^src/core/auth/",
        ],
      },
    },
    {
      name: "auditoria-capa",
      comment:
        "A server/auditoria/ no llegan la UI, lib/, el proxy, el entorno ni las capas de LECTURA o de acceso (consultas, lecturas, persistencia, acceso, carta pública, adaptadores): la auditoría la registra el CASO DE USO (o la operación de plataforma, o la sesión) dentro de la transacción del cambio que audita, nunca la persistencia ni una lectura. Un escritor de auditoría llamado desde la persistencia se escribiría sin que el caso de uso lo sepa y fuera del orden que fija su ficha.",
      severity: "error",
      from: { path: "^src/(app|components|lib)/|^src/server/(consultas|lecturas|persistencia|acceso|carta-publica|adaptadores)/|^src/(proxy|env)\\.ts$" },
      to: { path: "^src/server/auditoria/" },
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
        "Una Server Action ya migrada a caso de uso (ACCIONES_CON_CASO_DE_USO, .dependency-cruiser-excepciones.cjs) no usa en runtime src/lib/db.ts, @prisma/client, el reintento/transacción (con-reintento, reintentar, y la transacción de gobierno server/actions/con-gobierno.ts: serializable con reintento e invariantes, Hito 3 paso 0.7), la idempotencia I3 ni la auditoría (el escritor `registrarCambioAuditado`, en `src/server/auditoria/`; Hito 5, pieza 5.4: salió de `core/permisos/auditoria.ts`, que ahora es solo lo puro): todo eso pasa por su caso de uso. `import type` sí se permite. Incluye la fachada core/movimientos/public-servidor.ts (C2), que reexporta los clasificadores del reintento, el ciclo y la idempotencia, y `src/lib/transaccion-serializable.ts` (Hito 5, pieza 5.3: `conTransaccionSerializable` salió de `core/movimientos/con-reintento.ts` a `lib`): si no, la regla se esquivaría importándolos por ahí.",
      severity: "error",
      from: { path: ACCIONES_MIGRADAS },
      to: {
        path: [
          "^src/lib/db\\.ts$",
          "^node_modules/(@prisma/client|\\.prisma/client)/",
          "^src/core/movimientos/(con-reintento|reintentar|idempotencia|public-servidor)\\.ts$",
          "^src/lib/transaccion-serializable\\.ts$",
          "^src/server/auditoria/",
          "^src/server/actions/con-gobierno\\.ts$",
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
      from: { path: "^src/(app/\\(carta-publica\\)/|components/carta-publica/|server/carta-publica/sin-sesion\\.ts$)" },
      to: { path: "^src/(core/auth/|core/permisos/|server/|lib/auth\\.ts$)", pathNot: ALCANCE_CARTA_PUBLICA, reachable: true },
    },
    {
      name: "publica-sin-sesion-solo-desde-carta-publica",
      comment:
        "server/carta-publica/sin-sesion.ts elige el cliente de base SIN sesión (la empresa sale de la URL): solo lo importan las páginas de app/(carta-publica)/. Importarlo desde la app con sesión o un caso de uso saltearía el contexto de usuario.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/(app/\\(carta-publica\\)/|server/carta-publica/sin-sesion\\.ts$)" },
      to: { path: "^src/server/carta-publica/sin-sesion\\.ts$" },
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
      name: "operaciones-de-plataforma-solo-desde-scripts",
      comment:
        "Add-on C2 (ADR-008/ADR-010) y Bloque 5A P9 (ADR-011/ADR-012): la política de plataforma de una empresa (permisosEditables, dosPaneles) y el registro de módulos " +
        "solo los cambia la plataforma, por scripts/politica-empresa.ts y scripts/modulos-empresa.ts (fuera de src/). Esas operaciones viven en src/server/operaciones-de-plataforma/ y " +
        "ningún otro archivo de src/ las importa: ni una Server Action, ni una pantalla, ni otro caso de uso. La base lo exige además (solo el dueño y motor2_plataforma escriben ModuloEmpresa). " +
        "Complemento: test/arquitectura/politica-de-empresa-solo-plataforma.test.ts.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/server/operaciones-de-plataforma/" },
      to: { path: "^src/server/operaciones-de-plataforma/" },
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
    includeOnly: ["^src/", "^plataforma/", "^next\\.config\\.ts$", "^node_modules/"],
    exclude: { path: ["^\\.next/", "^plataforma/\\.next/", "^plataforma/node_modules/"] },
    doNotFollow: { path: ["^node_modules/"] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
