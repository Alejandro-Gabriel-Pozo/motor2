import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { mensajeSiSeReenviaMuyPronto } from "@/core/features/empresa/invitacion";
import { mensajeSiNoPuedeGestionar } from "@/core/permisos/gestion-de-usuarios";
import { actorDesdeLaBase, objetivoEnSucursal } from "@/server/lecturas/permisos/gestion-de-usuarios";
import { SELECCION_DE_ROL_PARA_JERARQUIA } from "@/core/permisos/jerarquia";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { conGobierno } from "../../con-gobierno";
import type { InvitacionPorEnviar } from "./enviar-invitacion-y-anotar";
import { asegurarInvitacionDeVinculacion, conCupoDeCorreo, reservarMailDeInvitacion, rotarInvitacionPendiente } from "./invitaciones-de-usuario-en-tx";

type ResultadoInvitarAVincular = ResultadoCaso<
  { porEnviar: InvitacionPorEnviar },
  | "MEMBRESIA_NO_ENCONTRADA"
  | "YA_VINCULO_GOOGLE"
  | "TECHO_DE_PRIVILEGIO"
  | "REENVIO_MUY_PRONTO"
  | "INVITACION_RECHAZADA"
  | "SIN_TOKEN"
  | "CUPO_DE_CORREO_AGOTADO"
  | "INVARIANTE_DE_GOBIERNO"
>;

/**
 * Caso de uso «invitar a vincular»: a un miembro que todavía no entró con Google (un precargado) se le deja la invitación para que vincule su cuenta (Hito 3, Fase I,
 * I.5i de `docs/plan-hito-3-pureza.md`). Es el cuerpo de la transacción que antes vivía en línea en la Server Action `invitarAVincular`
 * (`src/server/actions/auth/usuarios.ts`), movido TAL CUAL: mismas lecturas, mismo orden, mismos mensajes. La Server Action quedó como adaptador
 * (`conPermiso("gestion_usuarios")` → este caso de uso → el mail, DESPUÉS de confirmar → `aResultadoAccion`), sin guard de formato: solo recibe un id (`SIN_GUARD`).
 * Este caso de uso no manda nada: devuelve en `datos.porEnviar` la invitación y su token (los del último intento de la transacción).
 *
 * En la transacción de gobierno (`conGobierno`, serializable con reintento), igual que antes: la membresía de la sucursal activa; que no haya vinculado ya su cuenta de
 * Google (sin mirar si su cuenta está desactivada en toda la plataforma: S-19, no se filtra el estado de la tabla global `User`); el techo de gestión sobre esa persona (con quien actúa RELEÍDO de la base en la sucursal
 * activa, `actorDesdeLaBase`: O35-B de O.35, no con el contexto de la sesión, que pudo quedar viejo); la invitación de vinculación pendiente que ya tuviera, con el
 * freno de un minuto desde su último envío medido contra la hora del pedido (`mensajeSiSeReenviaMuyPronto`); y, si había una, rotarla
 * (`rotarInvitacionPendiente`), si no, crearla (`asegurarInvitacionDeVinculacion`), con su auditoría (el paso compartido de invitaciones); y, S-21, la reserva del mail
 * (`reservarMailDeInvitacion`: cupo del día y marca de envío; sin cupo se deshace la transacción entera y se devuelve `CUPO_DE_CORREO_AGOTADO`). Sin invariantes de gobierno:
 * `siSeViola` está solo por la forma.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. El azar del token lo pasa la Server Action (el borde).
 *
 * @contract Deja una invitación de vinculación pendiente (nueva o con el token rotado) para el miembro de la sucursal activa que todavía no vinculó Google, con su auditoría; devuelve el token para el mail.
 * @idempotency No aplica — cada pedido rota el token y manda otro mail; lo que acota la repetición es el freno de un minuto desde el último envío.
 * @transaction conGobierno (conTransaccionSerializable con reintento). El mail lo manda la Server Action después del commit.
 * @sideEffects registrarCambioAuditado (UsuarioEmpresa.invitacion: creada o reenviada, y UsuarioEmpresa.mailDeInvitacion por el mail reservado), por el paso compartido; anota la marca de envío (`enviadaEn`).
 * @ficha permiso=gestion_usuarios transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function invitarAVincularCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "empresaId" | "sucursalId"> & Pick<ContextoDeAccion, "transaccion" | "ahora">,
  comando: { membresiaId: string },
  azar: FuenteDeAzar,
): Promise<ResultadoInvitarAVincular> {
  const { membresiaId } = comando;
  const ahora = actor.ahora; // la hora del pedido (D.3)
  return conCupoDeCorreo(
    () =>
      conGobierno(
        actor,
        async (tx): Promise<ResultadoInvitarAVincular> => {
          const membresia = await tx.usuarioSucursal.findUnique({
            where: { id: membresiaId },
            select: { sucursalId: true, usuarioId: true, rol: { select: SELECCION_DE_ROL_PARA_JERARQUIA }, usuario: { select: { email: true, accounts: { where: { provider: "google" }, select: { id: true }, take: 1 } } } },
          });
          if (!membresia || membresia.sucursalId !== actor.sucursalId) return fracaso("MEMBRESIA_NO_ENCONTRADA", "No se encontró esa membresía.");
          if (membresia.usuario.accounts.length > 0) return fracaso("YA_VINCULO_GOOGLE", "Esa persona ya vinculó su cuenta de Google.");
          // S-19: NO se mira `activoGlobal` (tabla global `User`): decirlo filtraba el estado de una cuenta que se apaga por fuera de esta empresa. Igual que con una cuenta activa se deja la
          // invitación; la cuenta apagada no puede iniciar sesión (kill-switch de `decidirInicioDeSesion`), así que no le abre nada.
          const quienActua = await actorDesdeLaBase(tx, actor.empresaId, actor.usuarioId, actor.sucursalId);
          const rechazo = mensajeSiNoPuedeGestionar(quienActua, await objetivoEnSucursal(tx, actor.empresaId, membresia.usuarioId, membresia.rol));
          if (rechazo) return fracaso("TECHO_DE_PRIVILEGIO", rechazo);
          const email = membresia.usuario.email;
          const previa = await tx.invitacion.findFirst({ where: { empresaId: actor.empresaId, email, estado: "PENDIENTE", rolEmpresa: "vinculacion" }, select: { id: true, enviadaEn: true } });
          const muyPronto = mensajeSiSeReenviaMuyPronto(previa?.enviadaEn, ahora);
          if (muyPronto) return fracaso("REENVIO_MUY_PRONTO", muyPronto);
          const v = previa
            ? await rotarInvitacionPendiente(tx, { empresaId: actor.empresaId, invitacionId: previa.id, actorId: actor.usuarioId, ahora, azar })
            : await asegurarInvitacionDeVinculacion(tx, { empresaId: actor.empresaId, email, invitadoPorId: actor.usuarioId, ahora, azar });
          if (!v.ok) return fracaso("INVITACION_RECHAZADA", v.mensaje);
          if (!v.token) return fracaso("SIN_TOKEN", "No se pudo generar la invitación.");
          // S-21: el mail se reserva en ESTA transacción (cupo del día y marca de envío para el freno); sin cupo se deshace todo.
          await reservarMailDeInvitacion(tx, { empresaId: actor.empresaId, invitacionId: v.invitacionId, email, tipo: "vinculacion", actorId: actor.usuarioId, ahora });
          return exito(`Invitación para vincular la cuenta de Google enviada a "${email}".`, { porEnviar: { invitacionId: v.invitacionId, token: v.token, tipo: "vinculacion" } });
        },
        (mensaje) => fracaso("INVARIANTE_DE_GOBIERNO", mensaje),
      ),
    (mensaje) => fracaso("CUPO_DE_CORREO_AGOTADO", mensaje),
  );
}
