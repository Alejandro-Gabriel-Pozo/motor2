import { createHmac, timingSafeEqual } from "node:crypto";
import type { FuenteDeAzar } from "@/core/seguridad/azar";

/**
 * Códigos de un solo uso y tokens de la consola de plataforma (ADR-012 §2, ADR-019). Nada acá guarda ni muestra un código: devuelve el valor para
 * mostrarlo UNA vez y su hash para guardar.
 */

/** Los códigos de ingreso son de 6 dígitos: un SHA-256 solo se rompe por fuerza bruta en milisegundos, por eso llevan HMAC con un secreto del servidor. */
export function generarCodigoDeIngreso(azar: FuenteDeAzar): string {
  return String(azar.entero(0, 1_000_000)).padStart(6, "0");
}

/** HMAC-SHA256 en hexadecimal. `contexto` ata el hash a quien lo recibe (p. ej. `ingreso:<adminId>:<codigoId>`): el mismo código en otro contexto da otro hash. */
export function hashDeCodigo(codigo: string, secretoDelServidor: string, contexto: string): string {
  if (secretoDelServidor.length < 32) throw new Error("El secreto de códigos debe tener al menos 32 caracteres");
  return createHmac("sha256", secretoDelServidor).update(`${contexto}\n${codigo}`).digest("hex");
}

/** Comparación en tiempo constante de dos hashes hexadecimales (distinto largo → falso, sin lanzar). */
export function hashesIguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Letras y números sin los que se confunden al dictar (sin 0/O, 1/I/L). */
const ALFABETO_DE_RECUPERACION = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CANTIDAD_DE_CODIGOS_DE_RECUPERACION = 10;

/** `XXXXX-XXXXX`: 10 caracteres de un alfabeto de 31 (≈ 49 bits). Se muestran una sola vez al enrolar el segundo factor. */
export function generarCodigosDeRecuperacion(azar: FuenteDeAzar, cantidad = CANTIDAD_DE_CODIGOS_DE_RECUPERACION): string[] {
  return Array.from({ length: cantidad }, () => {
    const letras = Array.from({ length: 10 }, () => ALFABETO_DE_RECUPERACION[azar.entero(0, ALFABETO_DE_RECUPERACION.length)]).join("");
    return `${letras.slice(0, 5)}-${letras.slice(5)}`;
  });
}

/** Lo que se hashea es la forma canónica: mayúsculas, sin espacios ni guiones, para que `abcde fghjk` y `ABCDE-FGHJK` sean el mismo código. */
export function normalizarCodigoDeRecuperacion(codigo: string): string {
  return codigo.replace(/[\s-]/g, "").toUpperCase();
}

/** El hash que se guarda de un código de recuperación (su forma canónica, atada al administrador). Lo usan el script que los crea y el login que los consume: tienen que ser el mismo. */
export function hashDeCodigoDeRecuperacion(codigo: string, secretoDelServidor: string, adminId: string): string {
  return hashDeCodigo(normalizarCodigoDeRecuperacion(codigo), secretoDelServidor, `recuperacion:${adminId}`);
}
