import type { PrismaClient } from "@prisma/client";
import { cifrarSecreto } from "./cifrado";
import { generarCodigosDeRecuperacion, hashDeCodigoDeRecuperacion } from "./codigos";
import { normalizarEmail } from "./email-reservado";
import { generarSecretoTotp, uriOtpauth } from "./totp";
import { azarDelProceso } from "@/lib/azar";
import type { FuenteDeAzar } from "@/core/seguridad/azar";

/**
 * Alta de un administrador de plataforma (ADR-012 §2, ADR-019). No hay pantalla ni API para esto a propósito: la corre una persona, una vez, con la conexión del
 * rol `motor2_plataforma` y los dos secretos de la consola que viven FUERA del repositorio (`scripts/plataforma/crear-primer-admin.ts`).
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
 * Otra instalación donde también hay que comprobar el email antes de crear un administrador (ADR-025): un administrador de plataforma no entra a
 * ninguna empresa, de NINGUNA instalación. Solo `id`, `nombre` y un cliente ya abierto: ninguna `databaseUrl` entra a este módulo (el nombre de su
 * variable se arma solo en `plataforma/src/entorno.ts`, y un mensaje de error acá nunca podría filtrar una).
 */
export interface InstalacionARevisar {
  id: string;
  nombre: string;
  db: PrismaClient;
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

export interface OpcionesDeAltaDeAdmin {
  emisor?: string;
  /** Las instalaciones adicionales a revisar, además de la propia (ADR-025). Ninguna se escribe: solo se lee. */
  otrasBases?: readonly InstalacionARevisar[];
  /** Fuente de azar del id, el secreto TOTP y los códigos de recuperación (Pureza 1.5); por defecto la del proceso. Un test pasa una fija. */
  azar?: FuenteDeAzar;
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ConflictoDeEmail = "usuario" | "invitacion" | null;

/** `null` si el email está libre en esta base; si no, por qué no puede ser administrador de plataforma. */
async function conflictoDeEmail(db: PrismaClient, email: string): Promise<ConflictoDeEmail> {
  // El administrador no entra a ninguna empresa (ADR-012 §1): el mismo email no puede ser, además, usuario de una.
  const usuario = await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
  if (usuario) return "usuario";

  // Tampoco si ya lo invitaron a ser gerente de una empresa (E5): al aceptar entraría a ella, y el administrador no entra a ninguna.
  const invitada = await db.invitacion.findFirst({ where: { email, estado: "PENDIENTE" }, select: { id: true } }).catch((e: unknown) => {
    // Una base un paso atrás en la migración de invitaciones (ADR-024/025) no puede tener ninguna pendiente.
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2021") return null;
    throw e;
  });
  return invitada ? "invitacion" : null;
}

function mensajeDeConflicto(conflicto: "usuario" | "invitacion", nombreDeInstalacion?: string): string {
  const donde = nombreDeInstalacion ? ` en la instalación «${nombreDeInstalacion}»` : "";
  return conflicto === "usuario"
    ? `Ese email ya es de un usuario de una empresa${donde}: un administrador de plataforma no puede serlo.`
    : `Ese email tiene una invitación pendiente para ser gerente de una empresa${donde}: un administrador de plataforma no puede serlo.`;
}

export async function crearAdminDePlataforma(
  db: PrismaClient,
  entrada: { email: string; nombre: string },
  secretos: SecretosDeLaConsola,
  opciones: OpcionesDeAltaDeAdmin = {},
): Promise<AdminDePlataformaCreado> {
  const email = normalizarEmail(entrada.email);
  const nombre = entrada.nombre.trim();
  if (!EMAIL_VALIDO.test(email)) throw new AdminDePlataformaInvalidoError("El email no es válido.");
  if (nombre.length === 0) throw new AdminDePlataformaInvalidoError("Falta el nombre.");

  const existente = await db.adminPlataforma.findUnique({ where: { email }, select: { id: true } });
  if (existente) throw new AdminDePlataformaInvalidoError("Ya existe un administrador de plataforma con ese email.");

  const conflictoPropio = await conflictoDeEmail(db, email);
  if (conflictoPropio) throw new AdminDePlataformaInvalidoError(mensajeDeConflicto(conflictoPropio));

  // Las instalaciones adicionales (ADR-025): nada se escribe todavía, así que un rechazo acá no deja nada a medias.
  for (const instalacion of opciones.otrasBases ?? []) {
    let conflicto: ConflictoDeEmail;
    try {
      conflicto = await conflictoDeEmail(instalacion.db, email);
    } catch (causa) {
      throw new InstalacionNoRevisableError(instalacion.id, instalacion.nombre, causa);
    }
    if (conflicto) throw new AdminDePlataformaInvalidoError(mensajeDeConflicto(conflicto, instalacion.nombre));
  }

  const azar = opciones.azar ?? azarDelProceso;
  const id = azar.uuid();
  const secretoTotp = generarSecretoTotp(azar);
  const codigosDeRecuperacion = generarCodigosDeRecuperacion(azar);
  await db.$transaction(async (tx) => {
    await tx.adminPlataforma.create({ data: { id, email, nombre, secretoTotp: cifrarSecreto(secretoTotp, secretos.claveTotp, id, azar) } });
    await tx.codigoDeRecuperacionPlataforma.createMany({
      data: codigosDeRecuperacion.map((codigo) => ({ adminId: id, hashCodigo: hashDeCodigoDeRecuperacion(codigo, secretos.secretoCodigos, id) })),
    });
  });
  return { id, email, secretoTotp, uriOtpauth: uriOtpauth(secretoTotp, email, opciones.emisor ?? "Motor 2 plataforma"), codigosDeRecuperacion };
}
