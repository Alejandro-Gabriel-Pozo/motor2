import { createHmac, timingSafeEqual } from "node:crypto";
import type { FuenteDeAzar } from "@/core/seguridad/azar";

/**
 * TOTP (RFC 6238, HMAC-SHA1, 6 dígitos, paso de 30 s) y base32 (RFC 4648) con `node:crypto`: sin dependencia nueva (ADR-019).
 * Todo recibe el tiempo por parámetro: nada acá lee el reloj.
 */
const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SEGUNDOS_POR_PASO = 30;
const DIGITOS = 6;
/** Pasos de tolerancia hacia cada lado (relojes desfasados): ±30 s. */
const VENTANA = 1;

export function codificarBase32(bytes: Uint8Array): string {
  let bits = 0;
  let valor = 0;
  let salida = "";
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

/** Acepta minúsculas, espacios y guiones (como los muestran las apps); devuelve `null` si queda algún carácter fuera del alfabeto. */
export function decodificarBase32(texto: string): Uint8Array | null {
  const limpio = texto.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!limpio) return null;
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const letra of limpio) {
    const indice = ALFABETO.indexOf(letra);
    if (indice < 0) return null;
    valor = ((valor << 5) | indice) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

/** 20 bytes aleatorios (el largo de la clave SHA-1) en base32: 32 caracteres. */
export function generarSecretoTotp(azar: FuenteDeAzar): string {
  return codificarBase32(azar.bytes(20));
}

export function pasoDeTotp(ahoraMs: number): number {
  return Math.floor(ahoraMs / 1000 / SEGUNDOS_POR_PASO);
}

/** El código de 6 dígitos de un paso. `secreto` es base32; si no lo es, lanza (un secreto guardado ilegible es un error de datos, no un código incorrecto). */
export function codigoTotp(secreto: string, paso: number): string {
  const clave = decodificarBase32(secreto);
  if (!clave) throw new Error("Secreto TOTP ilegible");
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const hmac = createHmac("sha1", clave).update(contador).digest();
  const desplazamiento = hmac[hmac.length - 1] & 15;
  const binario = ((hmac[desplazamiento] & 127) << 24) | (hmac[desplazamiento + 1] << 16) | (hmac[desplazamiento + 2] << 8) | hmac[desplazamiento + 3];
  return String(binario % 10 ** DIGITOS).padStart(DIGITOS, "0");
}

export type ResultadoTotp = { ok: true; paso: number } | { ok: false };

/**
 * Verifica un código dentro de la ventana ±1 paso. `ultimoPasoUsado` es el anti-replay: solo sirve un paso MAYOR al último aceptado, así el mismo
 * código no entra dos veces (quien lo espió no puede repetirlo). Devuelve el paso aceptado para guardarlo; la base lo guarda con un UPDATE
 * condicional (`WHERE totpUltimoPaso < paso`), que es lo que cierra la carrera entre dos pedidos simultáneos.
 */
export function verificarTotp(secreto: string, codigo: string, ahoraMs: number, ultimoPasoUsado: number | null): ResultadoTotp {
  const limpio = codigo.replace(/\s/g, "");
  if (!/^\d{6}$/.test(limpio)) return { ok: false };
  const centro = pasoDeTotp(ahoraMs);
  let aceptado: number | null = null;
  for (let paso = centro - VENTANA; paso <= centro + VENTANA; paso++) {
    // Se prueban TODOS los pasos (sin cortar en el primero) para que el tiempo no dependa de cuál coincide.
    const coincide = timingSafeEqual(Buffer.from(codigoTotp(secreto, paso)), Buffer.from(limpio));
    if (coincide && (ultimoPasoUsado === null || paso > ultimoPasoUsado) && (aceptado === null || paso > aceptado)) aceptado = paso;
  }
  return aceptado === null ? { ok: false } : { ok: true, paso: aceptado };
}

/** URI `otpauth://` que las apps de autenticación leen (a mano o por QR). */
export function uriOtpauth(secreto: string, email: string, emisor: string): string {
  const etiqueta = `${encodeURIComponent(emisor)}:${encodeURIComponent(email)}`;
  return `otpauth://totp/${etiqueta}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=${DIGITOS}&period=${SEGUNDOS_POR_PASO}`;
}
