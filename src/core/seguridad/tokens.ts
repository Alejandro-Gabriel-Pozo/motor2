import { createHash, randomBytes } from "node:crypto";

/**
 * Tokens opacos de alta entropía (sesión de la consola, enlace de invitación). Viven fuera de `core/plataforma` porque también los usa la app
 * de empresas (E5): quien los genera muestra el valor UNA vez y guarda solo `hashDeToken`.
 */

/** Token opaco: 32 bytes aleatorios (256 bits) en base64url. La base guarda solo `hashDeToken`. */
export function generarTokenOpaco(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 de un token de alta entropía (no hace falta HMAC: no se adivina por fuerza bruta). */
export function hashDeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
