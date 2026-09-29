import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * ADR-005 (`docs/adr/ADR-005-acceso-multiempresa-portal-carta.md`): `CARTA_API_TOKEN` pasa de variable de proceso única a un
 * token por empresa. A diferencia de `token-servicio.ts` (compara contra un puñado de valores conocidos de un env var), acá el
 * problema es RESOLVER a qué empresa pertenece un token desconocido — necesita guardarse en algo consultable (la base), nunca
 * en texto plano: si la base se filtra, un token en texto plano ahí es peor que hoy (un env var no viaja en un dump de datos).
 *
 * Mismo criterio de seguridad que `token-servicio.ts`: SHA-256 + comparación en tiempo constante. Acá el hash es lo que se
 * guarda (columna `tokenHash` de `TokenCartaEmpresa`, TODAVÍA NO EXISTE en `prisma/schema.prisma` real — solo en el schema
 * experimental `prisma/fase-a/schema.prisma`); el token en texto plano se muestra UNA sola vez al generarlo (en el momento de
 * `generarTokenCarta`) y no se puede recuperar después — si se pierde, se rota (se genera uno nuevo, se revoca el viejo).
 *
 * PURO — sin Prisma: la búsqueda por `tokenHash` en la base es responsabilidad de quien resuelva el caso de uso real, cuando el
 * modelo exista.
 */

const BYTES_DE_ENTROPIA = 32; // 256 bits, mismo orden que un token generado con `openssl rand -base64 32` (docs/setup-sucursal.md).

/** Token de servicio nuevo, en texto plano, listo para mostrar UNA vez. Nunca se persiste tal cual. */
export function generarTokenCartaPlano(): string {
  return randomBytesBase64Url(BYTES_DE_ENTROPIA);
}

/** El hash que sí se persiste (`TokenCartaEmpresa.tokenHash`). Hex, no base64: evita ambigüedad de padding en una columna `@unique`. */
export function hashTokenCarta(tokenPlano: string): string {
  return sha256Hex(tokenPlano);
}

/**
 * Compara un token recibido contra UN hash esperado (el de la fila que ya se encontró por `tokenHash` en la base — la búsqueda
 * en sí no es de acá, es Prisma). En tiempo constante, igual que `token-servicio.ts`: nunca revela por el tiempo de respuesta
 * si el token estuvo "cerca" del correcto.
 */
export function tokenCoincideConHash(tokenPlano: string, hashEsperado: string): boolean {
  const recibido = Buffer.from(sha256Hex(tokenPlano), "hex");
  const esperado = Buffer.from(hashEsperado, "hex");
  if (recibido.length !== esperado.length) return false;
  return timingSafeEqual(recibido, esperado);
}

/** `Authorization: Bearer <token>` → el token solo, o `null` si el header no tiene esa forma. Mismo parseo que `token-servicio.ts`. */
export function extraerTokenBearer(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  const m = /^Bearer[ ]+(\S+)[ ]*$/i.exec(authorizationHeader.trim());
  return m ? m[1] : null;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function randomBytesBase64Url(n: number): string {
  return randomBytes(n).toString("base64url");
}
