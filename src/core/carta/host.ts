/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`), Fase 2: interpreta el header `Host` de un pedido a la carta
 * pública — `carta.<empresa>.<dominioBase>` — para resolver de qué empresa es. PURO: no lee `headers()` ni nada de Next acá
 * (eso lo hace quien llama, en el Server Component o en el rewrite de `next.config.ts` — Fase 6 del plan). Esta misma regla
 * es la que documenta y prueba el patrón que después usa el rewrite declarativo (`has: [{ type: "host", value: … }]`), así
 * que los dos quedan sincronizados por construcción, no por copiar la regex a mano en dos lugares y esperar que no diverjan.
 *
 * Slug de empresa: mismas reglas que un hostname válido (RFC 1123, una etiqueta) — minúsculas, dígitos y guiones, sin guion al
 * principio ni al final, 1 a 63 caracteres. Coincide con `Empresa.slug` (Fase A, `prisma/fase-a/schema.prisma`).
 */

const PATRON_SLUG_EMPRESA = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patronHostCarta(dominioBase: string, grupo: string): string {
  return `carta\\.(${grupo}${PATRON_SLUG_EMPRESA})\\.${escaparRegex(dominioBase)}`;
}

function regexHostCarta(dominioBase: string): RegExp {
  return new RegExp(`^${patronHostCarta(dominioBase, "")}$`);
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
    { source: "/carta-publica/:empresa", has, destination: "/", permanent: false },
    { source: "/carta-publica/:empresa/:sucursal", has, destination: "/:sucursal", permanent: false },
  ];
}

/**
 * Fase 6: las reglas de `rewrites().beforeFiles` de `next.config.ts` para servir la carta en `carta.<empresa>.<dominioBase>`. La `/` del
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
 * `null` si el host no tiene la forma `carta.<slug>.<dominioBase>` exacta — entre otros, rechaza el dominio pelado (sin
 * `carta.`), `www.<dominioBase>`, un subdominio con más de un nivel (`carta.a.b.<dominioBase>`) y mayúsculas (se normalizan
 * antes de comparar, no se rechazan). El puerto (`:3000`, típico en desarrollo) se ignora.
 */
export function interpretarHostCarta(host: string | null | undefined, dominioBase: string | null | undefined): HostCartaInterpretado | null {
  if (!host || !dominioBase) return null;
  const limpio = host.trim().toLowerCase().replace(/:\d+$/, "");
  const base = dominioBase.trim().toLowerCase();
  if (!base) return null;
  const m = regexHostCarta(base).exec(limpio);
  return m ? { empresaSlug: m[1] } : null;
}

/** La inversa: el host público de la carta de una empresa, dado el slug y el dominio base. Para el link "Ver en vivo" del admin (Fase 4). */
export function armarHostCarta(empresaSlug: string, dominioBase: string): string {
  return `carta.${empresaSlug}.${dominioBase}`;
}
