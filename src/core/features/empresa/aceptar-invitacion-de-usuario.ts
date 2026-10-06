import type { Prisma } from "@prisma/client";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { actorDesdeLaBase, mensajeSiNoPuedeAsignarRol, mensajeSiNoPuedeGestionar, mensajeSiReactivaAdminSinSerGerente, objetivoEnSucursal, reactivaAUnAdmin } from "@/core/permisos/gestion-de-usuarios";
import { conInvariantesDeGobierno } from "@/core/permisos/invariantes";
import { hashDeToken } from "@/core/seguridad/tokens";
import { MENSAJE_ENLACE_NO_VALIDO, type ResultadoDeAceptacion } from "./aceptar-invitacion";
import { esTokenConFormaValida } from "./invitacion";

/**
 * Aceptar una invitación de USUARIO (E8, ADR-024). Corre DENTRO de una transacción serializable con `app.empresa_id` fijado en la empresa de la invitación y SIN efectos externos.
 *
 * Las membresías NO existen hasta acá. Por eso, al aceptar se REVALIDA, por cada sucursal que da la invitación, lo que valía cuando se invitó: que la sucursal y el rol sigan
 * activos, que quien la otorgó siga activo (cuenta, empresa y sucursal) y con `gestion_usuarios` en ESA sucursal, y que su techo de privilegio alcance al rol (dar «admin» es de
 * un administrador o del gerente) y a quien se incorpora. Todo o nada: si una sucursal falla, no se crea nada y la invitación sigue pendiente (se reenvía, volviéndola a firmar).
 *
 * El permiso por sucursal (`gestion_usuarios`, que pasa por el guard de módulos y capacidades) lo resuelve quien llama y entra como `puedeOtorgar`.
 */
export interface EntradaDeAceptacionDeUsuario {
  token: string;
  usuario: { id: string; email: string };
  ahora: Date;
  puedeOtorgar: (otorganteId: string, sucursalId: string) => Promise<boolean>;
}

const PEDIR_REENVIO = "Pedile a quien te invitó que te reenvíe la invitación.";

export async function aceptarInvitacionDeUsuario(tx: Prisma.TransactionClient, entrada: EntradaDeAceptacionDeUsuario): Promise<ResultadoDeAceptacion> {
  const { token, usuario, ahora } = entrada;
  if (!esTokenConFormaValida(token)) return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  const hashToken = hashDeToken(token);

  const invitacion = await tx.invitacion.findFirst({
    where: { hashToken, rolEmpresa: "usuario", estado: "PENDIENTE" },
    include: { sucursales: { include: { sucursal: { select: { id: true, nombre: true, activo: true } }, rol: { select: { id: true, nombre: true, clave: true, activo: true } } } } },
  });
  if (!invitacion || invitacion.venceEn.getTime() <= ahora.getTime()) return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  if (invitacion.email !== usuario.email.trim().toLowerCase()) return { ok: false, mensaje: `Esta invitación es para ${invitacion.email}. Entrá con esa cuenta de Google.` };
  const empresa = await tx.empresa.findUnique({ where: { id: invitacion.empresaId }, select: { id: true, nombre: true, estado: true } });
  if (!empresa || empresa.estado !== "ACTIVE") return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  if (invitacion.sucursales.length === 0) return { ok: false, mensaje: `Esta invitación no da acceso a ninguna sucursal. ${PEDIR_REENVIO}` };

  const cuentaPrevia = await tx.usuarioEmpresa.findUnique({ where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: empresa.id } }, select: { activo: true } });

  // Revalidación, sucursal por sucursal.
  for (const fila of invitacion.sucursales) {
    const donde = `«${fila.sucursal.nombre}»`;
    if (!fila.sucursal.activo || !fila.rol.activo) return { ok: false, mensaje: `La sucursal ${donde} o su rol ya no están disponibles. ${PEDIR_REENVIO}` };

    const otorgante = await tx.user.findUnique({ where: { id: fila.invitadoPorId }, select: { id: true, activoGlobal: true } });
    const cuentaDelOtorgante = await tx.usuarioEmpresa.findUnique({ where: { usuarioId_empresaId: { usuarioId: fila.invitadoPorId, empresaId: empresa.id } }, select: { activo: true } });
    if (!otorgante?.activoGlobal || !cuentaDelOtorgante?.activo) return { ok: false, mensaje: `Quien te dio acceso a ${donde} ya no puede hacerlo. ${PEDIR_REENVIO}` };
    if (!(await entrada.puedeOtorgar(fila.invitadoPorId, fila.sucursalId))) return { ok: false, mensaje: `Quien te dio acceso a ${donde} ya no tiene permiso para hacerlo. ${PEDIR_REENVIO}` };

    const actor = await actorDesdeLaBase(tx, empresa.id, fila.invitadoPorId, fila.sucursalId);
    const membresiaPrevia = await tx.usuarioSucursal.findUnique({ where: { usuarioId_sucursalId: { usuarioId: usuario.id, sucursalId: fila.sucursalId } }, include: { rol: true } });
    const objetivo = await objetivoEnSucursal(tx, empresa.id, usuario.id, membresiaPrevia?.rol ?? null);
    const rechazo = mensajeSiNoPuedeAsignarRol(actor, fila.rol) ?? mensajeSiNoPuedeGestionar(actor, objetivo);
    if (rechazo) return { ok: false, mensaje: `No se puede dar acceso a ${donde}: ${rechazo} ${PEDIR_REENVIO}` };
    const reactivaAdmin = await reactivaAUnAdmin(tx, empresa.id, usuario.id, { membresia: membresiaPrevia, cuentaDeEmpresa: cuentaPrevia });
    const rechazoReactivar = mensajeSiReactivaAdminSinSerGerente(actor, reactivaAdmin);
    if (rechazoReactivar) return { ok: false, mensaje: `No se puede dar acceso a ${donde}: ${rechazoReactivar} ${PEDIR_REENVIO}` };
  }

  const cambio = await tx.invitacion.updateMany({
    where: { id: invitacion.id, hashToken, estado: "PENDIENTE", venceEn: { gt: ahora } },
    data: { estado: "ACEPTADA", aceptadaEn: ahora, aceptadaPorId: usuario.id },
  });
  if (cambio.count !== 1) return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };

  await conInvariantesDeGobierno(tx, empresa.id, async () => {
    await tx.usuarioEmpresa.upsert({
      where: { usuarioId_empresaId: { usuarioId: usuario.id, empresaId: empresa.id } },
      update: { activo: true },
      create: { usuarioId: usuario.id, empresaId: empresa.id },
    });
    const primerOtorgante = invitacion.sucursales[0].invitadoPorId;
    await registrarCambioAuditado(tx, {
      entidad: "UsuarioEmpresa", entidadId: usuario.id, campo: "activo", descripcion: `Cuenta de "${usuario.email}" en la empresa: acepta la invitación`,
      valorAnterior: cuentaPrevia ? cuentaPrevia.activo : null, valorNuevo: true, actorId: primerOtorgante, sucursalId: null,
    });
    for (const fila of invitacion.sucursales) {
      const previa = await tx.usuarioSucursal.findUnique({ where: { usuarioId_sucursalId: { usuarioId: usuario.id, sucursalId: fila.sucursalId } }, include: { rol: true } });
      const membresia = await tx.usuarioSucursal.upsert({
        where: { usuarioId_sucursalId: { usuarioId: usuario.id, sucursalId: fila.sucursalId } },
        update: { rolId: fila.rolId, activo: true, ...(fila.notas !== null && { notas: fila.notas }) },
        create: { usuarioId: usuario.id, sucursalId: fila.sucursalId, empresaId: empresa.id, rolId: fila.rolId, ...(fila.notas !== null && { notas: fila.notas }) },
      });
      const descripcion = `Usuario "${usuario.email}" en la sucursal "${fila.sucursal.nombre}"`;
      const comun = { entidad: "UsuarioSucursal", entidadId: membresia.id, actorId: fila.invitadoPorId, sucursalId: fila.sucursalId } as const;
      await registrarCambioAuditado(tx, { ...comun, campo: "rol", descripcion: `${descripcion}: rol (alta por invitación)`, valorAnterior: previa?.rol.nombre ?? null, valorNuevo: fila.rol.nombre });
      await registrarCambioAuditado(tx, { ...comun, campo: "activo", descripcion: `${descripcion}: activo`, valorAnterior: previa ? previa.activo : null, valorNuevo: true });
    }
  });

  return { ok: true, empresaId: empresa.id, nombreEmpresa: empresa.nombre };
}

