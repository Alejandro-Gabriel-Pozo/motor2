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

function regexHostCarta(dominioBase: string): RegExp {
  return new RegExp(`^carta\\.(${PATRON_SLUG_EMPRESA})\\.${escaparRegex(dominioBase)}$`);
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
