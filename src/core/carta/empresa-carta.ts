/**
 * ADR-006 (`docs/adr/ADR-006-carta-como-modulo-interno.md`), Fase 2: resuelve qué empresa corresponde a un slug pedido por
 * la carta pública. Implementación de HOY (una sola empresa real, `Empresa` todavía no existe en `prisma/schema.prisma` —
 * solo en el schema experimental `prisma/fase-a/schema.prisma`, ver ADR-004): compara contra `CARTA_EMPRESA_SLUG`, sin
 * tocar la base.
 *
 * `async` a propósito, aunque hoy no haga ninguna espera real: cuando `Empresa` se adopte de verdad (Fase F del plan), esta
 * función pasa a `db.empresa.findUnique({ where: { slug } })` sin que cambie su firma ni haya que tocar a quien la llama
 * (`carta-publica/[empresa]/page.tsx` y el resto de la Fase 3).
 */

export interface EmpresaCarta {
  slug: string;
}

export async function resolverEmpresaCarta(slug: string): Promise<EmpresaCarta | null> {
  const esperado = process.env.CARTA_EMPRESA_SLUG?.trim();
  if (!esperado || slug !== esperado) return null;
  return { slug };
}

/** La empresa a la que sirve ESTA instalación (hoy la única, `CARTA_EMPRESA_SLUG`); `null` si no está configurada. Lo usa el admin para armar el link "Ver en vivo". */
export async function empresaCartaActual(): Promise<EmpresaCarta | null> {
  const slug = process.env.CARTA_EMPRESA_SLUG?.trim();
  return slug ? { slug } : null;
}
