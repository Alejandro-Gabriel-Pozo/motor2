import "server-only";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { conGobierno } from "../../con-gobierno";
import { invitacionGestionable, type ActorDeInvitacion } from "./invitacion-gestionable";
import { revocarInvitacionPendiente } from "./invitaciones-de-usuario-en-tx";

type ResultadoRevocarInvitacion = ResultadoCaso<null, "INVITACION_NO_GESTIONABLE" | "INVITACION_NO_ENCONTRADA" | "INVARIANTE_DE_GOBIERNO">;

/**
 * Caso de uso «revocar una invitación de usuario o de vinculación pendiente» (el enlace deja de servir; para volver a invitar a esa persona se la vuelve a agregar).
 * Hito 3, Fase I, I.5g de `docs/plan-hito-3-pureza.md`: es el cuerpo que antes vivía en línea en la Server Action `revocarInvitacion` (`src/server/actions/auth/usuarios.ts`),
 * movido TAL CUAL: misma transacción de gobierno, mismo orden, mismos mensajes. La Server Action quedó como adaptador (`conPermiso("gestion_usuarios")` → este caso de
 * uso → `aResultadoAccion`), sin guard de formato: solo recibe un id (`SIN_GUARD`).
 *
 * En la transacción de gobierno (`conGobierno`, serializable con reintento): la invitación tiene que ser gestionable desde la sucursal activa
 * (`invitacionGestionable`, el paso compartido: incluye la sucursal activa, y quien revoca puede otorgar cada sucursal con su rol —el gate real con `actor.db`— o, si es
 * de vinculación, alcanza con el techo a esa persona); después la revocación condicional y su auditoría (`revocarInvitacionPendiente`, el paso compartido de
 * invitaciones) con la hora del pedido. Sin invariantes de gobierno (no toca membresías): `siSeViola` nunca se usa, está para la forma del resultado.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint.
 *
 * @contract Deja revocada la invitación pendiente pedida, con su registro de auditoría, si quien actúa puede gestionarla desde su sucursal activa.
 * @idempotency Por estado — la revocación es condicional a que siga PENDIENTE: un segundo pedido (o dos simultáneos) devuelve «No se encontró esa invitación pendiente».
 * @transaction conGobierno (conTransaccionSerializable con reintento); el gate de las otras sucursales se pide con `actor.db`, fuera de la transacción.
 * @sideEffects registrarCambioAuditado (UsuarioEmpresa.invitacion: pendiente → revocada), por el paso compartido.
 * @ficha permiso=gestion_usuarios transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function revocarInvitacionCasoDeUso(
  actor: ActorDeInvitacion & Pick<ContextoDeAccion, "transaccion" | "ahora">,
  comando: { invitacionId: string },
): Promise<ResultadoRevocarInvitacion> {
  const { invitacionId } = comando;
  return conGobierno(
    actor,
    async (tx): Promise<ResultadoRevocarInvitacion> => {
      const g = await invitacionGestionable(actor, tx, invitacionId);
      if (!g.ok) return fracaso("INVITACION_NO_GESTIONABLE", g.mensaje);
      const revocada = await revocarInvitacionPendiente(tx, { empresaId: actor.empresaId, invitacionId, actorId: actor.usuarioId, ahora: actor.ahora });
      return revocada ? exito(`Invitación a "${g.invitacion.email}" revocada.`, null) : fracaso("INVITACION_NO_ENCONTRADA", "No se encontró esa invitación pendiente.");
    },
    (mensaje) => fracaso("INVARIANTE_DE_GOBIERNO", mensaje),
  );
}
