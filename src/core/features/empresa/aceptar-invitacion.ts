import type { Prisma } from "@prisma/client";
import { validarCuit } from "@/core/fiscal/public";
import { incorporarPrimerGerente } from "@/core/permisos/gerencia";
import { conInvariantesDeGobierno } from "@/core/permisos/invariantes";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { hashDeToken } from "@/core/seguridad/tokens";
import { esTokenConFormaValida } from "./invitacion";

/**
 * Aceptar la invitación del primer gerente (E5, ADR-020). Corre DENTRO de una transacción serializable con `app.empresa_id` fijado en la empresa de la
 * invitación (el RLS deja escribir solo ahí) y SIN efectos externos: la transacción puede reintentarse.
 *
 * Lo que hace, todo o nada:
 *  1. busca la invitación PENDIENTE por el hash del token y comprueba que sea del email de quien acepta, que no haya vencido y que la empresa siga en alta;
 *  2. valida el CUIT (E2) y que ninguna empresa lo tenga ya;
 *  3. la marca ACEPTADA con un update condicional (`estado = PENDIENTE` y no vencida): dos aceptaciones simultáneas no pueden ganar las dos;
 *  4. incorpora al invitado como gerente y admin de la primera sucursal, bajo las invariantes de gobierno;
 *  5. deja el rastro en la auditoría de la empresa, con el nuevo gerente como actor.
 * La empresa NO cambia de estado: sigue `PROVISIONING` hasta que la plataforma confirme el CUIT (E6). El CUIT queda en `Invitacion.cuitDeclarado`.
 */

export type ResultadoDeAceptacion = { ok: true; empresaId: string; nombreEmpresa: string } | { ok: false; mensaje: string };

/** El mismo mensaje para todo lo que hace inútil el enlace: no distingue «no existe» de «ya se usó», para no confirmar nada a quien adivina. */
export const MENSAJE_ENLACE_NO_VALIDO = "Este enlace ya no sirve: venció, se usó o la plataforma lo canceló. Pedile a la plataforma que te mande otro.";

export interface EntradaDeAceptacion {
  token: string;
  usuario: { id: string; email: string };
  cuit: unknown;
  ahora: Date;
}

export async function aceptarInvitacion(tx: Prisma.TransactionClient, entrada: EntradaDeAceptacion): Promise<ResultadoDeAceptacion> {
  const { token, usuario, ahora } = entrada;
  if (!esTokenConFormaValida(token)) return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  const hashToken = hashDeToken(token);

  const invitacion = await tx.invitacion.findFirst({ where: { hashToken, rolEmpresa: "gerente", estado: "PENDIENTE" } });
  if (!invitacion || invitacion.venceEn.getTime() <= ahora.getTime()) return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  if (invitacion.email !== usuario.email.trim().toLowerCase()) {
    return { ok: false, mensaje: `Esta invitación es para ${invitacion.email}. Entrá con esa cuenta de Google.` };
  }
  const empresa = await tx.empresa.findUnique({ where: { id: invitacion.empresaId }, select: { id: true, nombre: true, estado: true } });
  if (!empresa || empresa.estado !== "PROVISIONING") return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };

  const cuit = validarCuit(entrada.cuit);
  if (!cuit.ok) return { ok: false, mensaje: cuit.mensaje };
  if (cuit.valor === null) return { ok: false, mensaje: "Cargá el CUIT de la empresa." };
  if (await tx.empresa.findFirst({ where: { cuit: cuit.valor }, select: { id: true } })) {
    return { ok: false, mensaje: "Ya hay una empresa con ese CUIT. Revisalo; si es correcto, avisá a la plataforma." };
  }

  const cambio = await tx.invitacion.updateMany({
    where: { id: invitacion.id, hashToken, estado: "PENDIENTE", venceEn: { gt: ahora } },
    data: { estado: "ACEPTADA", aceptadaEn: ahora, aceptadaPorId: usuario.id, cuitDeclarado: cuit.valor },
  });
  if (cambio.count !== 1) return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };

  const incorporado = await conInvariantesDeGobierno(tx, empresa.id, () => incorporarPrimerGerente(tx, { empresaId: empresa.id, usuarioId: usuario.id }));
  if (!incorporado.ok) throw new ErrorDeAceptacion(incorporado.mensaje);

  await registrarCambioAuditado(tx, {
    entidad: "UsuarioEmpresa", entidadId: usuario.id, campo: "rolEmpresa", descripcion: `Cuenta de "${usuario.email}" en la empresa: acepta la invitación como gerente`,
    valorAnterior: null, valorNuevo: "gerente", actorId: usuario.id, sucursalId: null,
  });
  await registrarCambioAuditado(tx, {
    entidad: "UsuarioSucursal", entidadId: incorporado.membresiaId, campo: "activo", descripcion: `Usuario "${usuario.email}" en la sucursal "${incorporado.sucursalNombre}": alta por invitación`,
    valorAnterior: null, valorNuevo: true, actorId: usuario.id, sucursalId: incorporado.sucursalId,
  });

  return { ok: true, empresaId: empresa.id, nombreEmpresa: empresa.nombre };
}

/** Un fallo de datos de la empresa (no de quien acepta): deshace la transacción entera, incluida la marca ACEPTADA. */
export class ErrorDeAceptacion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeAceptacion";
  }
}
