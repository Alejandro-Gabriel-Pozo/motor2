import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { cifrarSecreto } from "./cifrado";
import { generarCodigosDeRecuperacion, hashDeCodigoDeRecuperacion } from "./codigos";
import { normalizarEmail } from "./email-reservado";
import { generarSecretoTotp, uriOtpauth } from "./totp";

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

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function crearAdminDePlataforma(
  db: PrismaClient,
  entrada: { email: string; nombre: string },
  secretos: SecretosDeLaConsola,
  emisor = "Motor 2 plataforma",
): Promise<AdminDePlataformaCreado> {
  const email = normalizarEmail(entrada.email);
  const nombre = entrada.nombre.trim();
  if (!EMAIL_VALIDO.test(email)) throw new AdminDePlataformaInvalidoError("El email no es válido.");
  if (nombre.length === 0) throw new AdminDePlataformaInvalidoError("Falta el nombre.");

  const existente = await db.adminPlataforma.findUnique({ where: { email }, select: { id: true } });
  if (existente) throw new AdminDePlataformaInvalidoError("Ya existe un administrador de plataforma con ese email.");
  // El administrador no entra a ninguna empresa (ADR-012 §1): el mismo email no puede ser, además, usuario de una.
  const usuario = await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } });
  if (usuario) throw new AdminDePlataformaInvalidoError("Ese email ya es de un usuario de una empresa: un administrador de plataforma no puede serlo.");

  // Tampoco si ya lo invitaron a ser gerente de una empresa (E5): al aceptar entraría a ella, y el administrador no entra a ninguna.
  const invitada = await db.invitacion.findFirst({ where: { email, estado: "PENDIENTE" }, select: { id: true } }).catch((e: unknown) => {
    // En una base que todavía no tiene la migración de invitaciones (el primer admin se crea ANTES de usar E5) no puede haber ninguna pendiente.
    if (typeof e === "object" && e !== null && "code" in e && e.code === "P2021") return null;
    throw e;
  });
  if (invitada) throw new AdminDePlataformaInvalidoError("Ese email tiene una invitación pendiente para ser gerente de una empresa: un administrador de plataforma no puede serlo.");

  const id = randomUUID();
  const secretoTotp = generarSecretoTotp();
  const codigosDeRecuperacion = generarCodigosDeRecuperacion();
  await db.$transaction(async (tx) => {
    await tx.adminPlataforma.create({ data: { id, email, nombre, secretoTotp: cifrarSecreto(secretoTotp, secretos.claveTotp, id) } });
    await tx.codigoDeRecuperacionPlataforma.createMany({
      data: codigosDeRecuperacion.map((codigo) => ({ adminId: id, hashCodigo: hashDeCodigoDeRecuperacion(codigo, secretos.secretoCodigos, id) })),
    });
  });
  return { id, email, secretoTotp, uriOtpauth: uriOtpauth(secretoTotp, email, emisor), codigosDeRecuperacion };
}
