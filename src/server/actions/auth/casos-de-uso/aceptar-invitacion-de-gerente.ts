import "server-only";
import type { Prisma } from "@prisma/client";
import { validarCuit } from "@/core/fiscal/public";
import { esTokenConFormaValida } from "@/core/features/empresa/invitacion";
import { ErrorDeAceptacion, MENSAJE_ENLACE_NO_VALIDO, type ResultadoDeAceptacion } from "@/core/features/empresa/aceptar-invitacion";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { incorporarPrimerGerente } from "@/core/permisos/gerencia";
import { InvarianteViolada } from "@/core/permisos/invariantes";
import { conInvariantesDeGobierno } from "@/server/actions/con-gobierno";
import { hashDeToken } from "@/core/seguridad/tokens";
import { marcarInvitacionAceptada } from "@/server/persistencia/invitaciones/marcar-invitacion-aceptada";
import { invitacionConSuBase } from "@/server/sesion/invitacion";

/**
 * Caso de uso «aceptar la invitación del PRIMER GERENTE» (E5, ADR-020; Hito 3, B3-5 de `docs/plan-hito-3-pureza.md`). Antes eran dos piezas: la orquestación
 * `aceptarInvitacionDelToken` (`core/auth/invitacion.ts`, luego `server/sesion/invitacion.ts`) y el cuerpo `aceptarInvitacion` (`core/features/empresa/aceptar-invitacion.ts`,
 * P3: leía y escribía la base). Se mudaron TAL CUAL (mismas consultas, mismo orden, mismos mensajes: lo fija `test/auth/caracterizacion/huella-de-aceptacion.test.ts`).
 * La Server Action `aceptarMiInvitacion` (`server/actions/auth/invitacion.ts`) quedó como adaptador: sesión, token de la cookie, este caso de uso, efectos de Next.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No hay permiso que chequear (`permiso=SIN_PERMISO`, en la lista cerrada `CASOS_SIN_PERMISO`): quien acepta
 * todavía no tiene empresa ni membresía; la autoridad es el token del enlace (sale de una cookie httpOnly) más el email de su cuenta de Google, y los valida este mismo caso de
 * uso. La base de la empresa sale de la invitación (`invitacionConSuBase`), nunca de un id del llamador. La hora entra por `ahora` (la fija la acción): el caso de uso no lee el reloj.
 *
 * Lo que hace, todo o nada, en una transacción serializable con `app.empresa_id` fijado en la empresa de la invitación (el RLS deja escribir solo ahí) y SIN efectos externos (la
 * transacción puede reintentarse):
 *  1. busca la invitación PENDIENTE por el hash del token y comprueba que sea del email de quien acepta, que no haya vencido y que la empresa siga en alta;
 *  2. valida el CUIT (E2) y que ninguna empresa lo tenga ya;
 *  3. la marca ACEPTADA con un update condicional (`estado = PENDIENTE` y no vencida; `marcarInvitacionAceptada`, `server/persistencia/invitaciones/`, B3-6): dos aceptaciones
 *     simultáneas no pueden ganar las dos;
 *  4. incorpora al invitado como gerente y admin de la primera sucursal, bajo las invariantes de gobierno;
 *  5. deja el rastro en la auditoría de la empresa, con el nuevo gerente como actor.
 * La empresa NO cambia de estado: sigue `PROVISIONING` hasta que la plataforma confirme el CUIT (E6). El CUIT queda en `Invitacion.cuitDeclarado`. Un fallo de invariantes o de
 * datos de la empresa (`ErrorDeAceptacion`) deshace todo, incluida la marca ACEPTADA, y vuelve como mensaje.
 *
 * @contract Incorpora al invitado como primer gerente de la empresa en alta de la invitación, una sola vez por enlace, con el CUIT declarado y su auditoría.
 * @idempotency Por estado: el update condicional `estado = PENDIENTE` y no vencida arbitra el reintento y la carrera (el segundo uso devuelve «Este enlace ya no sirve»).
 * @transaction conTransaccionSerializable bajo la empresa de la invitación (invitacionConSuBase), con conInvariantesDeGobierno alrededor del alta del gerente.
 * @sideEffects registrarCambioAuditado (UsuarioEmpresa.rolEmpresa y UsuarioSucursal.activo, con el nuevo gerente como actor). Sin efectos externos.
 * @ficha permiso=SIN_PERMISO transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function aceptarInvitacionDeGerenteCasoDeUso(entrada: EntradaDeAceptacion): Promise<ResultadoDeAceptacion> {
  const invitacion = await invitacionConSuBase(entrada.token, entrada.ahora);
  if (!invitacion || invitacion.vista.estado !== "PENDIENTE") return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  try {
    return await conTransaccionSerializable(invitacion.transaccion, (tx) => aceptarEnLaTransaccion(tx, entrada));
  } catch (e) {
    if (e instanceof InvarianteViolada) return { ok: false, mensaje: e.mensaje };
    if (e instanceof ErrorDeAceptacion) return { ok: false, mensaje: e.message };
    throw e;
  }
}

interface EntradaDeAceptacion {
  token: string;
  usuario: { id: string; email: string };
  cuit: unknown;
  ahora: Date;
}

/** El cuerpo, dentro de la transacción (antes `aceptarInvitacion` de `core/features/empresa/aceptar-invitacion.ts`). */
async function aceptarEnLaTransaccion(tx: Prisma.TransactionClient, entrada: EntradaDeAceptacion): Promise<ResultadoDeAceptacion> {
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

  if (!(await marcarInvitacionAceptada(tx, { invitacionId: invitacion.id, hashToken, aceptadaPorId: usuario.id, ahora, cuitDeclarado: cuit.valor }))) {
    return { ok: false, mensaje: MENSAJE_ENLACE_NO_VALIDO };
  }

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
