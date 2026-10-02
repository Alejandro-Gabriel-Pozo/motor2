/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`), Fase 2: interpreta el header `Host` de un pedido a la carta
 * pública — `<empresa>.<dominioBase>` (UN solo nivel: un wildcard `*.<dominioBase>` cubre todas las empresas; el `dominioBase` de
 * producción es `carta.zuluhub.com.ar`, un dominio dedicado a las cartas, distinto del de la app) — para resolver de qué empresa es. PURO: no lee `headers()` ni nada de Next acá
 * (eso lo hace quien llama, en el Server Component o en el rewrite de `next.config.ts` — Fase 6 del plan). Esta misma regla
 * es la que documenta y prueba el patrón que después usa el rewrite declarativo (`has: [{ type: "host", value: … }]`), así
 * que los dos quedan sincronizados por construcción, no por copiar la regex a mano en dos lugares y esperar que no diverjan.
 *
 * Slug de empresa: mismas reglas que un hostname válido (RFC 1123, una etiqueta) — minúsculas, dígitos y guiones, sin guion al
 * principio ni al final, 1 a 63 caracteres. Coincide con `Empresa.slug` (tabla real desde ADR-007, A2).
 */

const PATRON_SLUG_EMPRESA = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
/** Parámetro de path con forma de slug (acotado: un `:empresa` sin patrón aceptaba cualquier cosa y se copiaba tal cual a la redirección). */
const PARAM_SLUG = "([a-z0-9][a-z0-9-]{0,62})";

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patronHostCarta(dominioBase: string, grupo: string): string {
  return `(${grupo}${PATRON_SLUG_EMPRESA})\\.${escaparRegex(dominioBase)}`;
}

function regexHostCarta(dominioBase: string): RegExp {
  return new RegExp(`^${patronHostCarta(dominioBase, "")}$`);
}

/** Largo máximo de un slug público: el de una etiqueta de hostname (RFC 1123); los slugs de sucursal (60) caben. */
const LARGO_MAXIMO_SLUG_PUBLICO = 63;
const RE_SLUG_PUBLICO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * `true` si el segmento de URL tiene forma de slug (minúsculas, dígitos y guiones sueltos, hasta 63). La carta pública lo exige ANTES de
 * tocar la base: un valor de la URL con un byte nulo (`%00`) u otro texto que Postgres no acepta haría fallar la consulta (500), y uno
 * cualquiera gastaría una consulta; con forma inválida no existe ninguna empresa ni sucursal con ese slug, así que es un 404.
 */
export function esSlugPublicoValido(valor: unknown): valor is string {
  return typeof valor === "string" && valor.length <= LARGO_MAXIMO_SLUG_PUBLICO && RE_SLUG_PUBLICO.test(valor);
}

export interface ReglaRewriteCarta {
  source: string;
  has: { type: "host"; value: string }[];
  destination: string;
}

export interface ReglaRedirectCarta {
  source: string;
  has: { type: "host"; value: string }[];
  destination: string;
  permanent: false;
}

/**
 * Fase 6 (pulido): en el host de la carta, los links internos de las páginas (`hrefVolver`, los del portal) son paths
 * `/carta-publica/<empresa>/...` — las páginas no leen el Host (son ISR) — y acá se llevan a la forma limpia: `/carta-publica/<e>` → `/` y
 * `/carta-publica/<e>/<sucursal>` → `/<sucursal>`. No permanente: si el esquema de URLs cambia, un 308 cacheado sería difícil de deshacer. Va en
 * `redirects()`, que corre antes de los rewrites. Mismo patrón de host que `reglasRewriteCarta`; sin `dominioBase`, sin reglas.
 */
export function reglasRedirectCarta(dominioBase: string | null | undefined): ReglaRedirectCarta[] {
  const base = dominioBase?.trim().toLowerCase();
  if (!base) return [];
  const has = [{ type: "host" as const, value: patronHostCarta(base, "?<empresaDelHost>") }];
  return [
    { source: `/carta-publica/:empresa${PARAM_SLUG}`, has, destination: "/", permanent: false },
    { source: `/carta-publica/:empresa${PARAM_SLUG}/:sucursal${PARAM_SLUG}`, has, destination: "/:sucursal", permanent: false },
  ];
}

export interface ReglaRedirectAppACarta {
  source: string;
  missing: { type: "host"; value: string }[];
  destination: string;
  permanent: false;
}

/**
 * Con `dominioBase` configurado, el host de la app NO sirve la carta: `/carta-publica/<empresa>[/<sucursal>]` en cualquier host que no
 * sea el de la carta redirige (307) a `https://<empresa>.<dominioBase>/[<sucursal>]`. `localhost` y `127.0.0.1` pelados quedan
 * afuera (desarrollo y la suite e2e entran por path). Sin `dominioBase` no hay reglas: una instalación sin subdominio sirve la carta
 * por path. Va en `redirects()`, junto a `reglasRedirectCarta` (que actúa solo EN el host de la carta; las dos condiciones son disjuntas).
 * Los parámetros solo aceptan forma de slug: la redirección nunca copia al destino texto arbitrario del pedido.
 */
export function reglasRedirectAppACarta(dominioBase: string | null | undefined): ReglaRedirectAppACarta[] {
  const base = dominioBase?.trim().toLowerCase();
  if (!base) return [];
  const missing = [{ type: "host" as const, value: `(?:${patronHostCarta(base, "?:")}|localhost|127\\.0\\.0\\.1)` }];
  return [
    { source: `/carta-publica/:empresa${PARAM_SLUG}`, missing, destination: `https://:empresa.${base}/`, permanent: false },
    { source: `/carta-publica/:empresa${PARAM_SLUG}/:sucursal${PARAM_SLUG}`, missing, destination: `https://:empresa.${base}/:sucursal`, permanent: false },
  ];
}

/**
 * Fase 6: las reglas de `rewrites().beforeFiles` de `next.config.ts` para servir la carta en `<empresa>.<dominioBase>`. La `/` del
 * host es el portal de la empresa y `/<sucursal>` la carta de esa sucursal; ambas se reescriben a `/carta-publica/...` (la URL del
 * navegador no cambia). El patrón del host es EL MISMO de `interpretarHostCarta` (con el slug capturado como `:empresa`). Sin
 * `dominioBase`, sin reglas: la carta solo se sirve por path. Solo se reescriben rutas de un segmento con forma de slug, así
 * `/_next/…`, `/api/…` y los archivos con punto (`/favicon.ico`) pasan de largo. Las reglas se calculan al compilar: `CARTA_DOMINIO_BASE`
 * tiene que estar en el entorno del build, no solo del arranque.
 */
export function reglasRewriteCarta(dominioBase: string | null | undefined): ReglaRewriteCarta[] {
  const base = dominioBase?.trim().toLowerCase();
  if (!base) return [];
  const has = [{ type: "host" as const, value: patronHostCarta(base, "?<empresa>") }];
  return [
    { source: "/", has, destination: "/carta-publica/:empresa" },
    { source: "/:sucursal([a-z0-9][a-z0-9-]*)", has, destination: "/carta-publica/:empresa/:sucursal" },
  ];
}

export interface HostCartaInterpretado {
  empresaSlug: string;
}

/**
 * `null` si el host no tiene la forma `<slug>.<dominioBase>` exacta — entre otros, rechaza el dominio base pelado, un subdominio
 * con más de un nivel (`a.b.<dominioBase>`) y mayúsculas (se normalizan antes de comparar, no se rechazan). El puerto (`:3000`,
 * típico en desarrollo) se ignora.
 */
export function interpretarHostCarta(host: string | null | undefined, dominioBase: string | null | undefined): HostCartaInterpretado | null {
  if (!host || !dominioBase) return null;
  const limpio = host.trim().toLowerCase().replace(/:\d+$/, "");
  const base = dominioBase.trim().toLowerCase();
  if (!base) return null;
  const m = regexHostCarta(base).exec(limpio);
  return m ? { empresaSlug: m[1] } : null;
}

/**
 * `true` si el host cae DENTRO de la zona de las cartas: es el dominio base mismo o cualquier subdominio suyo, sea o no una carta
 * válida. Todo lo que está en la zona y no es una carta (`<slug>.<dominioBase>`) tiene que responder 404, nunca la aplicación.
 */
export function esHostDeZonaCarta(host: string | null | undefined, dominioBase: string | null | undefined): boolean {
  if (!host || !dominioBase) return false;
  const limpio = host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const base = dominioBase.trim().toLowerCase();
  if (!base) return false;
  return limpio === base || limpio.endsWith(`.${base}`);
}

/** Patrón de host (para `has` de Next) de toda la zona de cartas: el dominio base y cualquier subdominio suyo de un nivel. */
export function patronHostZonaCarta(dominioBase: string): string {
  return `(?:[a-z0-9-]+\\.)?${escaparRegex(dominioBase)}`;
}

/**
 * En el host de una carta SOLO se sirven la raíz (portal de la empresa) y `/<sucursal>`; cualquier otro path (`/login`, `/api/…`,
 * `/mesas/…`, una carpeta de la app) es 404 sin llegar a la aplicación. Es la misma forma que reescribe `reglasRewriteCarta`.
 */
export function esMetodoDeLecturaEnHostCarta(metodo: string): boolean {
  return metodo === "GET" || metodo === "HEAD";
}

export function esPathPermitidoEnHostCarta(pathname: string): boolean {
  return pathname === "/" || /^\/[a-z0-9][a-z0-9-]*\/?$/.test(pathname);
}

/**
 * Dirección pública de la carta (o del portal, sin `sucursalSlug`) de una empresa, para los links del admin. Con `dominioBase` de un
 * dominio real: `https://<empresa>.<dominioBase>/[<sucursal>]`. Sin `dominioBase`, o con `localhost`/`*.localhost` (desarrollo y e2e, sin DNS ni
 * https): el path `/carta-publica/<empresa>[/<sucursal>]` en el host actual.
 */
export function urlCartaPublica(dominioBase: string | null | undefined, empresaSlug: string, sucursalSlug?: string): string {
  const base = dominioBase?.trim().toLowerCase();
  if (!base || base === "localhost" || base.endsWith(".localhost")) return `/carta-publica/${empresaSlug}${sucursalSlug ? `/${sucursalSlug}` : ""}`;
  return `https://${armarHostCarta(empresaSlug, base)}/${sucursalSlug ?? ""}`;
}

/** La inversa: el host público de la carta de una empresa, dado el slug y el dominio base. Para los links "Ver la carta de motor2" del admin (Fase 4). */
export function armarHostCarta(empresaSlug: string, dominioBase: string): string {
  return `${empresaSlug}.${dominioBase}`;
}
