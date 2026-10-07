import "dotenv/config";
import { randomUUID } from "node:crypto";
import { sembrarEmpresa } from "../../../plataforma/src/servidor/sembrar-empresa";
import { generarTokenOpaco, hashDeToken } from "../../../src/core/seguridad/tokens";
import { prismaAdmin } from "../../setup/cliente-duenio";
import { azarDelProceso } from "../../../src/lib/azar";

/**
 * Fixtures de `invitacion-aceptar.spec.ts` (E5, ADR-020): una empresa en alta —sembrada con la misma función que usa el alta de la consola— y una
 * invitación de gerente con un token CONOCIDO (el real solo viaja por mail). Se siembra como dueño con `empresaId` explícito.
 *
 * La empresa queda en `PROVISIONING`, que no cuenta como activa: no cambia la "empresa por defecto" del resto de la suite.
 */
export interface InvitacionSembrada {
  empresaId: string;
  nombre: string;
  email: string;
  token: string;
}

export async function sembrarInvitacion(opciones: { venceEn?: Date } = {}): Promise<InvitacionSembrada> {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const empresaId = `alta-${marca}`;
  const nombre = `E2E En alta ${marca}`;
  const email = `invitado-${marca}@local.test`;
  const token = generarTokenOpaco(azarDelProceso);
  await prismaAdmin.empresa.create({ data: { id: empresaId, nombre, slug: empresaId, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "PROVISIONING" } });
  await prismaAdmin.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.empresa_id', ${empresaId}, true)`;
    await sembrarEmpresa(tx, empresaId, "Central");
  });
  await prismaAdmin.invitacion.create({
    data: { empresaId, email, rolEmpresa: "gerente", hashToken: hashDeToken(token), venceEn: opciones.venceEn ?? new Date(Date.now() + 3_600_000) },
  });
  return { empresaId, nombre, email, token };
}

/** Un usuario que ya existe (el invitado, u otra persona) con una sesión real y SIN pertenencia a ninguna empresa. */
export async function crearUsuarioSinEmpresa(email: string): Promise<{ usuarioId: string; sessionToken: string }> {
  const user = await prismaAdmin.user.upsert({ where: { email }, update: {}, create: { email, activoGlobal: true } });
  const sessionToken = randomUUID();
  await prismaAdmin.session.create({ data: { sessionToken, userId: user.id, expires: new Date(Date.now() + 86_400_000) } });
  return { usuarioId: user.id, sessionToken };
}

export async function leerInvitacion(token: string) {
  return prismaAdmin.invitacion.findUniqueOrThrow({ where: { hashToken: hashDeToken(token) } });
}

export async function pertenenciasDe(email: string) {
  return prismaAdmin.usuarioEmpresa.findMany({ where: { usuario: { email } }, select: { empresaId: true, rolEmpresa: true } });
}

/**
 * Una invitación de USUARIO (E8, ADR-024) a `empresaId` con una sucursal y un rol, firmada por `invitadoPorId`, con un token CONOCIDO. Como dueño (salta el RLS y los triggers).
 */
export async function sembrarInvitacionDeUsuario(entrada: { empresaId: string; sucursalId: string; rolId: string; invitadoPorId: string; email?: string; venceEn?: Date }) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = entrada.email ?? `invitada-${marca}@local.test`;
  const token = generarTokenOpaco(azarDelProceso);
  const inv = await prismaAdmin.invitacion.create({
    data: { empresaId: entrada.empresaId, email, rolEmpresa: "usuario", invitadoPorId: entrada.invitadoPorId, hashToken: hashDeToken(token), venceEn: entrada.venceEn ?? new Date(Date.now() + 3_600_000) },
  });
  await prismaAdmin.invitacionSucursal.create({ data: { empresaId: entrada.empresaId, invitacionId: inv.id, sucursalId: entrada.sucursalId, rolId: entrada.rolId, invitadoPorId: entrada.invitadoPorId } });
  return { id: inv.id, email, token };
}
