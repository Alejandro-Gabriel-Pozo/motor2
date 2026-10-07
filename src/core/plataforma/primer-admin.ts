import { cifrarSecreto } from "./cifrado";
import { generarCodigosDeRecuperacion, hashDeCodigoDeRecuperacion } from "./codigos";
import { normalizarEmail } from "./email-reservado";
import { generarSecretoTotp, uriOtpauth } from "./totp";
import type { FuenteDeAzar } from "@/core/seguridad/azar";

/**
 * El cálculo PURO del alta de un administrador de plataforma (ADR-012 §2, ADR-019): validar la entrada, armar los mensajes de conflicto y generar el material del alta (id,
 * secreto TOTP, códigos de recuperación, el secreto cifrado y los hashes). Sin base: la lectura de conflictos y la escritura las hace
 * `plataforma/src/servidor/alta-de-admin.ts` (`crearAdminDePlataforma`), que le pide a este módulo todo lo demás (Pureza Fase 4, tramo B). No hay pantalla ni API para esto a
 * propósito: la corre una persona, una vez, con la conexión del rol `motor2_plataforma` y los dos secretos de la consola que viven FUERA del repositorio
 * (`scripts/plataforma/crear-primer-admin.ts`).
 *
 * Lo único que sale en claro es lo que la persona tiene que guardar ahora (el secreto TOTP, para escanearlo, y los códigos de recuperación): la base recibe el
 * secreto cifrado (AES-256-GCM, atado al id del administrador) y de cada código solo su hash.
 */
export class AdminDePlataformaInvalidoError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "AdminDePlataformaInvalidoError";
  }
}

export interface SecretosDeLaConsola {
  claveTotp: string;
  secretoCodigos: string;
}

export interface AdminDePlataformaCreado {
  id: string;
  email: string;
  secretoTotp: string;
  uriOtpauth: string;
  codigosDeRecuperacion: string[];
}

/**
 * No se pudo revisar una instalación adicional (su base no respondió). A diferencia de las pantallas de la consola (ADR-025 §4: una instalación caída
 * no las tumba), acá se falla cerrado: el alta es irreversible en la práctica (imprime el TOTP y los códigos una sola vez) y crea un sujeto con poder
 * sobre TODAS las instalaciones, así que sin poder revisar una no hay forma de saber si el email ya es de un usuario ahí. El mensaje nunca incluye el
 * error original (podría traer host o usuario de la conexión): queda solo como `cause`, sin imprimirse.
 */
export class InstalacionNoRevisableError extends Error {
  readonly instalacionId: string;

  constructor(instalacionId: string, nombre: string, causa: unknown) {
    super(`No pudimos revisar la instalación «${nombre}» (${instalacionId}): su base no respondió.`, { cause: causa });
    this.name = "InstalacionNoRevisableError";
    this.instalacionId = instalacionId;
  }
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** El email normalizado y el nombre sin espacios, o el error de validación (el mismo mensaje y el mismo orden que siempre: primero el email, después el nombre). */
export function validarAltaDeAdmin(entrada: { email: string; nombre: string }): { email: string; nombre: string } {
  const email = normalizarEmail(entrada.email);
  const nombre = entrada.nombre.trim();
  if (!EMAIL_VALIDO.test(email)) throw new AdminDePlataformaInvalidoError("El email no es válido.");
  if (nombre.length === 0) throw new AdminDePlataformaInvalidoError("Falta el nombre.");
  return { email, nombre };
}

export const MENSAJE_ADMIN_YA_EXISTE = "Ya existe un administrador de plataforma con ese email.";

export function mensajeDeConflicto(conflicto: "usuario" | "invitacion", nombreDeInstalacion?: string): string {
  const donde = nombreDeInstalacion ? ` en la instalación «${nombreDeInstalacion}»` : "";
  return conflicto === "usuario"
    ? `Ese email ya es de un usuario de una empresa${donde}: un administrador de plataforma no puede serlo.`
    : `Ese email tiene una invitación pendiente para ser gerente de una empresa${donde}: un administrador de plataforma no puede serlo.`;
}

/**
 * El material del alta: el id, el secreto TOTP, los códigos de recuperación, el secreto cifrado y los hashes de los códigos. El ORDEN de las llamadas al azar es el de siempre
 * (id, secreto TOTP, códigos de recuperación y, al cifrar, el IV): con una fuente fija el resultado es idéntico byte a byte.
 */
export function materialDeAltaDeAdmin(azar: FuenteDeAzar, secretos: SecretosDeLaConsola, email: string, emisor = "Motor 2 plataforma") {
  const id = azar.uuid();
  const secretoTotp = generarSecretoTotp(azar);
  const codigosDeRecuperacion = generarCodigosDeRecuperacion(azar);
  const secretoTotpCifrado = cifrarSecreto(secretoTotp, secretos.claveTotp, id, azar);
  const hashesDeCodigos = codigosDeRecuperacion.map((codigo) => hashDeCodigoDeRecuperacion(codigo, secretos.secretoCodigos, id));
  return { id, secretoTotp, secretoTotpCifrado, codigosDeRecuperacion, hashesDeCodigos, uriOtpauth: uriOtpauth(secretoTotp, email, emisor) };
}
