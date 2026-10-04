import { randomUUID } from "node:crypto";
import { cifrarSecreto } from "../../../src/core/plataforma/cifrado";
import { generarCodigosDeRecuperacion, hashDeCodigo, hashDeCodigoDeRecuperacion } from "../../../src/core/plataforma/codigos";
import { generarSecretoTotp } from "../../../src/core/plataforma/totp";
import { crearPrismaE2E, resolverUrlE2E } from "./base-e2e";

/**
 * La consola de plataforma en los E2E (E4, ADR-019): sus dos secretos son valores FIJOS y descartables (la base E2E se vacía en cada corrida), compartidos entre
 * `playwright.config.ts` (que se los pasa al servidor de la consola) y los specs (que siembran un administrador cifrado con ellos y firman un código de ingreso
 * conocido, porque el mail de la consola no se puede leer desde otro proceso). Nunca se usan fuera de esta suite.
 */
export const SECRETO_DE_CODIGOS_E2E = "e2e-consola-secreto-de-codigos-descartable-0123456789";
export const CLAVE_TOTP_E2E = Buffer.alloc(32, 7).toString("base64");

export interface AdminSembrado {
  id: string;
  email: string;
  secretoTotp: string;
  codigosDeRecuperacion: string[];
}

/** Siembra un administrador activo con TOTP y códigos de recuperación, con la conexión del DUEÑO (la consola, con su rol, no puede crear administradores). */
export async function sembrarAdminDePlataforma(email: string): Promise<AdminSembrado> {
  const prisma = crearPrismaE2E(resolverUrlE2E(process.env));
  try {
    const id = randomUUID();
    const secretoTotp = generarSecretoTotp();
    await prisma.adminPlataforma.create({ data: { id, email, nombre: "Admin E2E", secretoTotp: cifrarSecreto(secretoTotp, CLAVE_TOTP_E2E, id) } });
    const codigosDeRecuperacion = generarCodigosDeRecuperacion(3);
    await prisma.codigoDeRecuperacionPlataforma.createMany({
      data: codigosDeRecuperacion.map((codigo) => ({ adminId: id, hashCodigo: hashDeCodigoDeRecuperacion(codigo, SECRETO_DE_CODIGOS_E2E, id) })),
    });
    return { id, email, secretoTotp, codigosDeRecuperacion };
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Reemplaza el código que la consola acaba de generar para ese administrador (el real solo viaja por mail) por uno que el spec conoce, firmado como lo
 * firma la consola. Devuelve cuántos códigos vigentes encontró (1 si el pedido ya se procesó).
 */
export async function fijarCodigoDeIngreso(adminId: string, codigo: string): Promise<number> {
  const prisma = crearPrismaE2E(resolverUrlE2E(process.env));
  try {
    const vigentes = await prisma.codigoDeIngresoPlataforma.findMany({ where: { adminId, usadoEn: null, invalidadoEn: null } });
    for (const { id } of vigentes) {
      await prisma.codigoDeIngresoPlataforma.update({ where: { id }, data: { hashCodigo: hashDeCodigo(codigo, SECRETO_DE_CODIGOS_E2E, `ingreso:${adminId}:${id}`) } });
    }
    return vigentes.length;
  } finally {
    await prisma.$disconnect();
  }
}

export async function leerDeLaBase<T>(consulta: (prisma: ReturnType<typeof crearPrismaE2E>) => Promise<T>): Promise<T> {
  const prisma = crearPrismaE2E(resolverUrlE2E(process.env));
  try {
    return await consulta(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
