import { esSlugPublicoValido, patronHostZonaCarta, urlCartaPublica, type ReglaRedirectAppACarta, type ReglaRedirectCarta, type ReglaRewriteCarta } from "./host";

/**
 * ADD-ON `CARTA_EMPRESA_UNICA` (ADR-006, sección «Carta de una empresa única en el dominio base»): con la variable puesta a un slug de empresa, el dominio
 * base de las cartas (`CARTA_DOMINIO_BASE`, p. ej. `carta.hotelesdelneuquen.com.ar`) ES la carta de ESA empresa, sin su slug en la URL: `/` es el portal y
 * `/<sucursal>` la carta. Es otra forma de resolver el host, no un reemplazo: `<slug>.<CARTA_DOMINIO_BASE>` sigue funcionando.
 *
 * Apagado por defecto (sin la variable, todo devuelve `[]`/`false`). Quitarlo = borrar este archivo, su test y los enganches de una línea
 * (next.config.ts, proxy.ts, instrumentation.ts, env.ts, el portal del admin) — `git revert` del commit que lo agregó.
 *
 * El slug sale SIEMPRE de la configuración, nunca del pedido: un valor de la URL o del `Host` no puede elegir la empresa. Si la variable tiene un
 * valor que no es un slug, las funciones que arman reglas TIRAN (el build falla) en vez de seguir sin el add-on: una carta mal configurada no
 * debe salir a producción creyendo que está activa. Una empresa que no existe en la base resuelve a 404 (la página lo decide), nunca a otra empresa.
 *
 * PURO: no lee `process.env` ni nada de Next; quien llama pasa los valores.
 */

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PARAM_SUCURSAL = "([a-z0-9][a-z0-9-]{0,62})";

/** `null` si el add-on está apagado (sin slug); tira si hay slug inválido o falta el dominio base. */
function configuracion(dominioBase: string | null | undefined, slug: string | null | undefined): { base: string; slug: string } | null {
  if (slug === undefined || slug === null || slug === "") return null;
  if (!esSlugPublicoValido(slug)) throw new Error("CARTA_EMPRESA_UNICA no es un slug válido (minúsculas, dígitos y guiones sueltos, hasta 63 caracteres).");
  const base = dominioBase?.trim().toLowerCase();
  if (!base) throw new Error("CARTA_EMPRESA_UNICA necesita CARTA_DOMINIO_BASE: la carta de la empresa única se sirve en ese dominio.");
  return { base, slug };
}

/** `has` de Next: el host EXACTO del dominio base (Next lo ancla y lo compara en minúsculas y sin puerto). */
function hostBasePelado(base: string): { type: "host"; value: string }[] {
  return [{ type: "host", value: escaparRegex(base) }];
}

/**
 * `rewrites().beforeFiles`: en el host exacto del dominio base, `/` → `/carta-publica/<slug>` y `/<sucursal>` → `/carta-publica/<slug>/<sucursal>`.
 * Mismo criterio de rutas que `reglasRewriteCarta` (un segmento con forma de slug; `/_next`, `/api` y los archivos con punto pasan de largo).
 */
export function reglasRewriteEmpresaUnica(dominioBase: string | null | undefined, slug: string | null | undefined): ReglaRewriteCarta[] {
  const c = configuracion(dominioBase, slug);
  if (!c) return [];
  const has = hostBasePelado(c.base);
  return [
    { source: "/", has, destination: `/carta-publica/${c.slug}` },
    { source: "/:sucursal([a-z0-9][a-z0-9-]*)", has, destination: `/carta-publica/${c.slug}/:sucursal` },
  ];
}

/**
 * `redirects()`: los links internos de las páginas (ISR, no leen el Host) son `/carta-publica/<slug>/...`.
 *  - En el host del dominio base se llevan a la URL limpia (`/` y `/<sucursal>`).
 *  - En cualquier otro host que no sea de la zona de cartas ni `localhost`/`127.0.0.1` (la app) redirigen al dominio base.
 * Solo para el slug configurado; cualquier otro `/carta-publica/<otro>/...` lo sigue resolviendo `reglasRedirectAppACarta`. Van ANTES de las reglas del
 * núcleo en `redirects()`: gana la primera que coincide.
 */
export function reglasRedirectEmpresaUnica(dominioBase: string | null | undefined, slug: string | null | undefined): (ReglaRedirectCarta | ReglaRedirectAppACarta)[] {
  const c = configuracion(dominioBase, slug);
  if (!c) return [];
  const has = hostBasePelado(c.base);
  const missing = [{ type: "host" as const, value: `(?:${patronHostZonaCarta(c.base)}|localhost|127\\.0\\.0\\.1)` }];
  const portal = `/carta-publica/${c.slug}`;
  const carta = `/carta-publica/${c.slug}/:sucursal${PARAM_SUCURSAL}`;
  return [
    { source: portal, has, destination: "/", permanent: false },
    { source: carta, has, destination: "/:sucursal", permanent: false },
    { source: portal, missing, destination: `https://${c.base}/`, permanent: false },
    { source: carta, missing, destination: `https://${c.base}/:sucursal`, permanent: false },
  ];
}

/**
 * `true` si el `Host` es EXACTAMENTE el dominio base y el add-on está activo (el proxy lo deja pasar como una carta). Comparación exacta, igual que la
 * del `has` de las reglas: lo que el proxy deja pasar es lo que las reglas reescriben, ni más (la raíz de la app quedaría expuesta) ni menos. Nunca tira.
 */
export function esHostDeEmpresaUnica(host: string | null | undefined, dominioBase: string | null | undefined, slug: string | null | undefined): boolean {
  if (!host || !dominioBase || !esSlugPublicoValido(slug)) return false;
  const base = dominioBase.trim().toLowerCase();
  if (!base) return false;
  return host.trim().toLowerCase().replace(/:\d+$/, "") === base;
}

/**
 * Dirección pública de la carta (o del portal) para los links del admin. Si la empresa es la única y el dominio base es uno real:
 * `https://<dominioBase>/[<sucursal>]`. En cualquier otro caso (add-on apagado, otra empresa, `localhost`/`*.localhost`), lo de siempre (`urlCartaPublica`).
 */
export function urlCartaPublicaConEmpresaUnica(dominioBase: string | null | undefined, slugEmpresaUnica: string | null | undefined, empresaSlug: string, sucursalSlug?: string): string {
  const base = dominioBase?.trim().toLowerCase();
  const esLocal = !base || base === "localhost" || base.endsWith(".localhost");
  if (!esLocal && slugEmpresaUnica && esSlugPublicoValido(slugEmpresaUnica) && slugEmpresaUnica === empresaSlug) return `https://${base}/${sucursalSlug ?? ""}`;
  return urlCartaPublica(dominioBase, empresaSlug, sucursalSlug);
}
