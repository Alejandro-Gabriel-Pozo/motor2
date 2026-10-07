import "server-only";
import { mensajeSiSeReenviaMuyPronto } from "@/core/features/empresa/invitacion";
import { exito, fracaso, type ResultadoCaso } from "@/core/resultado-caso";
import type { FuenteDeAzar } from "@/core/seguridad/azar";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { conGobierno } from "../../con-gobierno";
import type { InvitacionPorEnviar } from "./enviar-invitacion-y-anotar";
import { invitacionGestionable, type ActorDeInvitacion } from "./invitacion-gestionable";
import { rotarInvitacionPendiente } from "./invitaciones-de-usuario-en-tx";

type ResultadoReenviarInvitacion = ResultadoCaso<{ porEnviar: InvitacionPorEnviar }, "INVITACION_NO_GESTIONABLE" | "REENVIO_MUY_PRONTO" | "NO_SE_PUDO_REENVIAR" | "INVARIANTE_DE_GOBIERNO">;

/**
 * Caso de uso «reenviar una invitación pendiente»: rota el token (el enlace anterior deja de servir), renueva los 7 días y vuelve a firmar la invitación a nombre de
 * quien reenvía (Hito 3, Fase I, I.5h de `docs/plan-hito-3-pureza.md`). Es el cuerpo de la transacción que antes vivía en línea en la Server Action
 * `reenviarInvitacionPendiente` (`src/server/actions/auth/usuarios.ts`), movido TAL CUAL: mismas lecturas, mismo orden, mismos mensajes. La Server Action quedó como
 * adaptador (`conPermiso("gestion_usuarios")` → este caso de uso → el mail, DESPUÉS de confirmar → `aResultadoAccion`), sin guard de formato: solo recibe un id
 * (`SIN_GUARD`). Este caso de uso no manda nada: devuelve en `datos.porEnviar` la invitación y el token nuevo (los del último intento de la transacción).
 *
 * En la transacción de gobierno (`conGobierno`, serializable con reintento): la invitación gestionable desde la sucursal activa (`invitacionGestionable`, con el gate real
 * de las otras sucursales pedido con `actor.db`); el freno de un minuto desde el último envío, medido contra la hora del pedido (`mensajeSiSeReenviaMuyPronto`); y la
 * rotación con su auditoría (`rotarInvitacionPendiente`, el paso compartido de invitaciones). Sin invariantes de gobierno: `siSeViola` está solo por la forma.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. El azar del token lo pasa la Server Action (el borde).
 *
 * @contract Deja la invitación pendiente con un token y un vencimiento nuevos, firmada (con todas sus sucursales) por quien reenvía, con su auditoría; devuelve el token para el mail.
 * @idempotency No aplica — cada reenvío rota el token y manda otro mail; lo que acota la repetición es el freno de un minuto desde el último envío.
 * @transaction conGobierno (conTransaccionSerializable con reintento); el gate de las otras sucursales se pide con `actor.db`. El mail lo manda la Server Action después del commit.
 * @sideEffects registrarCambioAuditado (UsuarioEmpresa.invitacion: pendiente → pendiente (reenviada)), por el paso compartido.
 * @ficha permiso=gestion_usuarios transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function reenviarInvitacionPendienteCasoDeUso(
  actor: ActorDeInvitacion & Pick<ContextoDeAccion, "transaccion" | "ahora">,
  comando: { invitacionId: string },
  azar: FuenteDeAzar,
): Promise<ResultadoReenviarInvitacion> {
  const { invitacionId } = comando;
  const ahora = actor.ahora; // la hora del pedido (D.3): el freno de un minuto y el vencimiento renovado se miden contra ella
  return conGobierno(
    actor,
    async (tx): Promise<ResultadoReenviarInvitacion> => {
      const g = await invitacionGestionable(actor, tx, invitacionId);
      if (!g.ok) return fracaso("INVITACION_NO_GESTIONABLE", g.mensaje);
      const muyPronto = mensajeSiSeReenviaMuyPronto(g.invitacion.enviadaEn, ahora);
      if (muyPronto) return fracaso("REENVIO_MUY_PRONTO", muyPronto);
      const rotada = await rotarInvitacionPendiente(tx, { empresaId: actor.empresaId, invitacionId, actorId: actor.usuarioId, ahora, azar });
      if (!rotada.ok || !rotada.token) return fracaso("NO_SE_PUDO_REENVIAR", rotada.ok ? "No se pudo reenviar la invitación." : rotada.mensaje);
      return exito(`Invitación reenviada a "${g.invitacion.email}". El enlace anterior ya no sirve.`, { porEnviar: { invitacionId, token: rotada.token, tipo: g.invitacion.tipo } });
    },
    (mensaje) => fracaso("INVARIANTE_DE_GOBIERNO", mensaje),
  );
}
