import { createHash, timingSafeEqual } from "node:crypto";

/**
 * `true` si el encabezado `Authorization` es exactamente `Bearer <secreto>`. Compara en tiempo constante (`timingSafeEqual` sobre los
 * SHA-256 de ambos, que siempre miden lo mismo) para que el tiempo de respuesta no delate cuántos caracteres del secreto se acertaron.
 * Sin secreto configurado (o vacío) nunca autoriza.
 */
export function autorizacionCronValida(encabezado: string | null | undefined, secreto: string | null | undefined): boolean {
  if (!secreto || !encabezado) return false;
  const a = createHash("sha256").update(encabezado).digest();
  const b = createHash("sha256").update(`Bearer ${secreto}`).digest();
  return timingSafeEqual(a, b);
}
