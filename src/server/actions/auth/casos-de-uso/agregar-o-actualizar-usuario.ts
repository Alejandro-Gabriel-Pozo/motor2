import "server-only";
import type { ComandoAgregarOActualizarUsuario } from "@/core/features/permisos/usuario.guard";
import { asegurarInvitacionDeUsuario, asegurarInvitacionDeVinculacion } from "./invitaciones-de-usuario-en-tx";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import {
  actorEnSucursal,
  mensajeSiNoPuedeAsignarRol,
  mensajeSiNoPuedeGestionar,
  mensajeSiReactivaAdminSinSerGerente,
  objetivoEnSucursal,
  reactivaAUnAdmin,
} from "@/core/permisos/gestion-de-usuarios";
import { conInvariantesDeGobierno } from "@/core/permisos/invariantes";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import { activarCuentaEnEmpresa, guardarMembresiaDeMiembro } from "@/server/persistencia/permisos/membresias";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { conGobierno } from "../../con-gobierno";
import type { InvitacionPorEnviar } from "./enviar-invitacion-y-anotar";

type ResultadoAgregarOActualizarUsuario = ResultadoCaso<
  { porEnviar: InvitacionPorEnviar | null },
  "ROL_INVALIDO" | "SUCURSAL_INVALIDA" | "CUENTA_DESACTIVADA_EN_PLATAFORMA" | "TECHO_DE_PRIVILEGIO" | "INVITACION_RECHAZADA" | "REACTIVA_ADMIN_SIN_SER_GERENTE" | "INVARIANTE_DE_GOBIERNO"
>;

/**
 * Caso de uso «agregar o actualizar a una persona en una sucursal» (equivalente de guardarUsuarioDesdePanel, Core.js:1142-1180; Hito 3, Fase I, I.5j de
 * `docs/plan-hito-3-pureza.md`). Es el cuerpo de la transacción de gobierno que antes vivía en línea en la Server Action `agregarOActualizarUsuario`
 * (`src/server/actions/auth/usuarios.ts`), movido TAL CUAL: mismas consultas, mismo orden, mismos mensajes. Quedan en la Server Action, en el mismo orden que antes: el
 * envoltorio (`conPermiso("gestion_usuarios")`), el formato (`guardComandoAgregarOActualizarUsuario`: el email), el permiso EXTRA sobre la sucursal pedida cuando no es la
 * activa (`requierePermiso` del gate, con `ctx.db`) y, DESPUÉS de que esta transacción confirmó, el mail (`enviarInvitacionYAnotar`, ADR-018: un mail no se retira y la
 * transacción puede reintentarse). Por eso este caso de uso no manda nada: devuelve en `datos.porEnviar` la invitación cuyo mail hay que mandar (o `null`), la del ÚLTIMO
 * intento de la transacción (cada intento devuelve la suya; antes, una variable que cada intento ponía en `null`).
 *
 * E8 (ADR-024): ya NO se crea el `User` ni la membresía de alguien que no es miembro de la empresa. A esa persona se le deja una INVITACIÓN (mail con enlace de un solo
 * uso): sus membresías nacen cuando la acepta con su cuenta de Google, revalidando entonces el permiso y el techo de quien la invitó. A quien YA es miembro de la empresa se
 * le suma la sucursal o se le cambia el rol directo, como siempre; si todavía no vinculó su cuenta de Google, se le deja además la invitación de vinculación.
 *
 * En la transacción de gobierno (`conGobierno`, serializable con reintento), igual que antes:
 *  1. «Rol inválido o inactivo» y «Sucursal inválida» (de la empresa).
 *  2. La persona por su email y su cuenta en la empresa.
 *  3. No es miembro: cuenta apagada en toda la plataforma → rechazo; techo para dar ese rol y para gestionarla; la invitación (`asegurarInvitacionDeUsuario`, con su
 *     auditoría) y el mensaje según haya que mandar el mail o se haya sumado la sucursal a la invitación pendiente.
 *  4. Es miembro: su membresía en esa sucursal; techo; reactivar a un admin es solo del gerente; y, midiendo las invariantes antes y después
 *     (`conInvariantesDeGobierno`), la cuenta en la empresa activa, la membresía con el rol (y las notas si vinieron), sus tres auditorías y, si no vinculó Google, la
 *     invitación de vinculación (`asegurarInvitacionDeVinculacion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. Escribe por `server/persistencia/permisos/membresias.ts`; las invitaciones, por
 * el paso compartido `./invitaciones-de-usuario-en-tx.ts` (I.5e, antes en `core`). La hora es la
 * del pedido (`actor.ahora`) y el azar de los tokens lo pasa la Server Action (el borde).
 *
 * @contract Deja a la persona con acceso pendiente (invitación) o efectivo (membresía con ese rol, cuenta de empresa activa) en la sucursal pedida, con su auditoría, si quien actúa puede darle ese rol y gestionarla; devuelve la invitación cuyo mail hay que mandar.
 * @idempotency Por estado — una invitación pendiente vigente absorbe el reintento (se le suma la sucursal y no hay mail nuevo); la membresía es un upsert (repetir no deja auditoría nueva: los valores no cambian).
 * @transaction conGobierno (conTransaccionSerializable con reintento) + conInvariantesDeGobierno alrededor de las escrituras del miembro; una invariante violada vuelve como fracaso INVARIANTE_DE_GOBIERNO.
 * @sideEffects registrarCambioAuditado (UsuarioEmpresa.activo; UsuarioSucursal.rol y .activo; las invitaciones auditan en su helper). El mail lo manda la Server Action después del commit.
 * @ficha permiso=gestion_usuarios transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function agregarOActualizarUsuarioCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "rolEmpresa" | "membresias" | "transaccion" | "ahora">,
  comando: ComandoAgregarOActualizarUsuario,
  azar: FuenteDeAzar,
): Promise<ResultadoAgregarOActualizarUsuario> {
  const { email } = comando;
  // La hora del pedido la fija `conPermiso` una vez (Pureza 1.2; D.3): vencimiento de la invitación y marca de envío salen de ella, no del reloj.
  const ahora = actor.ahora;
  return conGobierno(
    actor,
    async (tx): Promise<ResultadoAgregarOActualizarUsuario> => {
      const rol = await tx.rol.findFirst({ where: { id: comando.rolId, empresaId: actor.empresaId } });
      if (!rol || !rol.activo) return fracaso("ROL_INVALIDO", "Rol inválido o inactivo.");

      const sucursal = await tx.sucursal.findFirst({ where: { id: comando.sucursalId, empresaId: actor.empresaId }, select: { id: true, nombre: true } });
      if (!sucursal) return fracaso("SUCURSAL_INVALIDA", "Sucursal inválida.");

      const usuarioPrevio = await tx.user.findUnique({ where: { email }, select: { id: true, activoGlobal: true, accounts: { where: { provider: "google" }, select: { id: true } } } });
      const pertenenciaPrevia = usuarioPrevio
        ? await tx.usuarioEmpresa.findUnique({ where: { usuarioId_empresaId: { usuarioId: usuarioPrevio.id, empresaId: actor.empresaId } }, select: { activo: true } })
        : null;
      const quienActua = actorEnSucursal(actor, comando.sucursalId);

      // No es miembro de la empresa: INVITACIÓN. No se crea ningún User ni membresía hasta que acepte.
      if (!usuarioPrevio || !pertenenciaPrevia) {
        if (usuarioPrevio && !usuarioPrevio.activoGlobal) {
          return fracaso("CUENTA_DESACTIVADA_EN_PLATAFORMA", "La cuenta de ese email está desactivada en toda la plataforma. Consultalo con la plataforma.");
        }
        const objetivo = await objetivoEnSucursal(tx, actor.empresaId, usuarioPrevio?.id ?? null, null);
        const rechazo = mensajeSiNoPuedeAsignarRol(quienActua, rol) ?? mensajeSiNoPuedeGestionar(quienActua, objetivo);
        if (rechazo) return fracaso("TECHO_DE_PRIVILEGIO", rechazo);
        const invitada = await asegurarInvitacionDeUsuario(tx, {
          empresaId: actor.empresaId, email, invitadoPorId: actor.usuarioId,
          acceso: { sucursalId: comando.sucursalId, rolId: rol.id, ...(comando.notas !== undefined && { notas: comando.notas }) }, ahora, azar,
        });
        if (!invitada.ok) return fracaso("INVITACION_RECHAZADA", invitada.mensaje);
        if (invitada.token) {
          return exito(
            `Invitación enviada a "${email}": cuando la acepte con su cuenta de Google tendrá acceso a "${sucursal.nombre}". Mientras tanto figura en «Invitaciones pendientes».`,
            { porEnviar: { invitacionId: invitada.invitacionId, token: invitada.token, tipo: "usuario" } },
          );
        }
        return exito(`"${email}" ya tenía una invitación pendiente: se sumó "${sucursal.nombre}" a esa misma invitación (el enlace que ya recibió la cubre).`, { porEnviar: null });
      }

      // Ya es miembro de la empresa: se suma la sucursal o se cambia el rol directo.
      const existente = await tx.usuarioSucursal.findUnique({ where: { usuarioId_sucursalId: { usuarioId: usuarioPrevio.id, sucursalId: comando.sucursalId } }, include: { rol: true } });
      const objetivo = await objetivoEnSucursal(tx, actor.empresaId, usuarioPrevio.id, existente?.rol ?? null);
      const rechazo = mensajeSiNoPuedeAsignarRol(quienActua, rol) ?? mensajeSiNoPuedeGestionar(quienActua, objetivo);
      if (rechazo) return fracaso("TECHO_DE_PRIVILEGIO", rechazo);

      // Reactivar a un administrador (su membresía en esta sucursal, o su cuenta en la empresa) es solo del gerente: si no, quien tiene
      // `gestion_usuarios` desharía por esta vía lo que el gerente apagó con `apagar_cuenta_empresa`.
      const reactivaAdmin = await reactivaAUnAdmin(tx, actor.empresaId, usuarioPrevio.id, { membresia: existente, cuentaDeEmpresa: pertenenciaPrevia });
      const rechazoReactivar = mensajeSiReactivaAdminSinSerGerente(quienActua, reactivaAdmin);
      if (rechazoReactivar) return fracaso("REACTIVA_ADMIN_SIN_SER_GERENTE", rechazoReactivar);

      return conInvariantesDeGobierno(tx, actor.empresaId, async (): Promise<ResultadoAgregarOActualizarUsuario> => {
        // Las dos pertenencias van juntas: sin la de empresa el usuario no tendría contexto (core/auth/contexto.ts). Con su auditoría, en la misma transacción.
        await activarCuentaEnEmpresa(tx, { usuarioId: usuarioPrevio.id, empresaId: actor.empresaId });
        const membresia = await guardarMembresiaDeMiembro(tx, {
          usuarioId: usuarioPrevio.id, sucursalId: comando.sucursalId, empresaId: actor.empresaId, rolId: rol.id, ...(comando.notas !== undefined && { notas: comando.notas }),
        });
        await registrarCambioAuditado(tx, {
          entidad: "UsuarioEmpresa", entidadId: usuarioPrevio.id, campo: "activo", descripcion: `Cuenta de "${email}" en la empresa`,
          valorAnterior: pertenenciaPrevia.activo, valorNuevo: true, actorId: actor.usuarioId, sucursalId: null,
        });
        const descripcion = `Usuario "${email}" en la sucursal "${sucursal.nombre}"`;
        const comun = { entidad: "UsuarioSucursal", entidadId: membresia.id, actorId: actor.usuarioId, sucursalId: comando.sucursalId } as const;
        await registrarCambioAuditado(tx, { ...comun, campo: "rol", descripcion: `${descripcion}: rol`, valorAnterior: existente?.rol.nombre ?? null, valorNuevo: rol.nombre });
        await registrarCambioAuditado(tx, { ...comun, campo: "activo", descripcion: `${descripcion}: activo`, valorAnterior: existente ? existente.activo : null, valorNuevo: true });

        // Si todavía no vinculó su cuenta de Google, necesita la invitación de vinculación para poder entrar.
        if (usuarioPrevio.accounts.length === 0) {
          const vinculacion = await asegurarInvitacionDeVinculacion(tx, { empresaId: actor.empresaId, email, invitadoPorId: actor.usuarioId, ahora, azar });
          if (vinculacion.ok && vinculacion.token) {
            return exito(`Usuario "${email}" guardado en la sucursal. Todavía no entró con Google: le mandamos una invitación para que vincule su cuenta.`, {
              porEnviar: { invitacionId: vinculacion.invitacionId, token: vinculacion.token, tipo: "vinculacion" },
            });
          }
        }
        return exito(`Usuario "${email}" guardado en la sucursal.`, { porEnviar: null });
      });
    },
    (mensaje) => fracaso("INVARIANTE_DE_GOBIERNO", mensaje),
  );
}
