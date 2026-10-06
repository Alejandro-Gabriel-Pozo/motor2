import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifra el secreto TOTP de un administrador antes de guardarlo (AES-256-GCM): la base sola no alcanza para generar sus códigos.
 * Formato guardado: `v1.<iv>.<etiqueta>.<cifrado>`, todo en base64url. La clave son 32 bytes en base64 (variable `PLATAFORMA_CLAVE_TOTP`).
 */
const VERSION = "v1";

function claveDeBytes(claveBase64: string): Buffer {
  const clave = Buffer.from(claveBase64, "base64");
  if (clave.length !== 32) throw new Error("La clave de cifrado debe ser de 32 bytes en base64");
  return clave;
}

/** `contexto` (p. ej. el id del administrador) va como dato autenticado: un secreto copiado a la fila de otro administrador no descifra. */
export function cifrarSecreto(secreto: string, claveBase64: string, contexto: string): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv("aes-256-gcm", claveDeBytes(claveBase64), iv);
  cifrador.setAAD(Buffer.from(contexto));
  const cifrado = Buffer.concat([cifrador.update(secreto, "utf8"), cifrador.final()]);
  return [VERSION, iv.toString("base64url"), cifrador.getAuthTag().toString("base64url"), cifrado.toString("base64url")].join(".");
}

/** Devuelve el secreto, o `null` si el valor no es de este formato, la clave no es la que cifró, o el contexto no coincide (no lanza por datos ajenos). */
export function descifrarSecreto(guardado: string, claveBase64: string, contexto: string): string | null {
  const partes = guardado.split(".");
  if (partes.length !== 4 || partes[0] !== VERSION) return null;
  try {
    const descifrador = createDecipheriv("aes-256-gcm", claveDeBytes(claveBase64), Buffer.from(partes[1], "base64url"));
    descifrador.setAAD(Buffer.from(contexto));
    descifrador.setAuthTag(Buffer.from(partes[2], "base64url"));
    return Buffer.concat([descifrador.update(Buffer.from(partes[3], "base64url")), descifrador.final()]).toString("utf8");
  } catch {
    return null;
  }
}
