import type { PrismaClient } from "@prisma/client";
import {
  AdminDePlataformaInvalidoError,
  InstalacionNoRevisableError,
  MENSAJE_ADMIN_YA_EXISTE,
  materialDeAltaDeAdmin,
  mensajeDeConflicto,
  validarAltaDeAdmin,
  type AdminDePlataformaCreado,
  type SecretosDeLaConsola,
} from "@/core/plataforma/primer-admin";
import { azarDelProceso } from "@/lib/azar";
import type { FuenteDeAzar } from "@/core/seguridad/azar";

/**
 * Alta de un administrador de plataforma (ADR-012 §2, ADR-019). Mudada TAL CUAL desde `core/plataforma/primer-admin.ts` (Pureza Fase 4, tramo B): vive en la consola porque es de la
 * plataforma y porque `core-plataforma-solo-desde-la-consola` impide que `src/server` use los secretos (TOTP, códigos, cifrado) de `core/plataforma`. La validación, los mensajes y el material del
 * alta (id, TOTP, códigos, cifrado, hashes) son puros y siguen en `core/plataforma/primer-admin.ts`; acá se LEE (los conflictos de email, en esta y en las otras instalaciones) y se ESCRIBE.
 * No hay pantalla ni API para esto a propósito: la corre una persona, una vez, con la conexión del rol `motor2_plataforma` y los dos secretos de la consola que viven FUERA del repositorio
 * (`scripts/plataforma/crear-primer-admin.ts`).
 */

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

export interface OpcionesDeAltaDeAdmin {
  emisor?: string;
  /** Las instalaciones adicionales a revisar, además de la propia (ADR-025). Ninguna se escribe: solo se lee. */
  otrasBases?: readonly InstalacionARevisar[];
  /** Fuente de azar del id, el secreto TOTP y los códigos de recuperación (Pureza 1.5); por defecto la del proceso. Un test pasa una fija. */
  azar?: FuenteDeAzar;
}

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

export async function crearAdminDePlataforma(
  db: PrismaClient,
  entrada: { email: string; nombre: string },
  secretos: SecretosDeLaConsola,
  opciones: OpcionesDeAltaDeAdmin = {},
): Promise<AdminDePlataformaCreado> {
  const { email, nombre } = validarAltaDeAdmin(entrada);

  const existente = await db.adminPlataforma.findUnique({ where: { email }, select: { id: true } });
  if (existente) throw new AdminDePlataformaInvalidoError(MENSAJE_ADMIN_YA_EXISTE);

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

  const material = materialDeAltaDeAdmin(opciones.azar ?? azarDelProceso, secretos, email, opciones.emisor);
  await db.$transaction(async (tx) => {
    await tx.adminPlataforma.create({ data: { id: material.id, email, nombre, secretoTotp: material.secretoTotpCifrado } });
    await tx.codigoDeRecuperacionPlataforma.createMany({ data: material.hashesDeCodigos.map((hashCodigo) => ({ adminId: material.id, hashCodigo })) });
  });
  return { id: material.id, email, secretoTotp: material.secretoTotp, uriOtpauth: material.uriOtpauth, codigosDeRecuperacion: material.codigosDeRecuperacion };
}
