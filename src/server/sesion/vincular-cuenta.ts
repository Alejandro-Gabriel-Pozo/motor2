import "server-only";
import { conTransaccionSerializable, esChoqueDeIndiceUnico } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { InvarianteViolada } from "@/core/permisos/invariantes";
import { sirveParaVincular, TIPO_INVITACION_VINCULACION, type CuentaDeGoogle } from "@/core/auth/invitacion";
import { invitacionConSuBase } from "./invitacion";

/**
 * Vincula la cuenta de Google al `User` EXISTENTE, con el token de una invitación (E8, ADR-024). Auth.js no lo hace solo (el enlace automático por email está apagado):
 * el callback `signIn` corre ANTES de que Auth.js busque o cree nada, así que si acá queda creada la `Account`, Auth.js la encuentra y abre la sesión.
 *
 * Vivía en `core/auth/invitacion.ts` (Hito 3, B3-3 de `docs/plan-hito-3-pureza.md`). Es un ESCRITOR de infraestructura de login y no un caso de uso: corre dentro del callback
 * `signIn` de Auth.js (`decidirInicioDeSesion`, `server/sesion/acceso.ts`), sin Server Action ni contexto de empresa. Por eso sus escrituras (`Account` y, en la de vinculación,
 * consumir la `Invitacion`) están en `ESCRITURAS_FUERA_DE_PERSISTENCIA` como «Permanente», con su motivo.
 *
 * Condiciones (todas): invitación pendiente y no vencida de un tipo y una empresa que sirvan; el email de la invitación es EXACTAMENTE el del usuario; el usuario no tiene
 * otra cuenta de Google (con otro identificador NO se vincula nada: lo resuelve soporte, D2). La de vinculación se consume al vincular; las de gerente y de usuario no (las
 * consume la aceptación después). Idempotente si la cuenta ya es la de ese usuario. Devuelve `false` ante cualquier condición que falle.
 */
export async function vincularCuentaConInvitacion(entrada: { token: string | undefined; usuario: { id: string; email: string }; cuenta: CuentaDeGoogle; ahora?: Date }): Promise<boolean> {
  const ahora = entrada.ahora ?? new Date();
  const invitacion = await invitacionConSuBase(entrada.token, ahora);
  if (!invitacion) return false;
  const { vista } = invitacion;
  if (vista.estado !== "PENDIENTE" || !sirveParaVincular(vista)) return false;
  if (vista.email !== entrada.usuario.email.trim().toLowerCase()) return false;
  const { cuenta, usuario } = entrada;
  try {
    return await conTransaccionSerializable(
      invitacion.transaccion,
      async (tx) => {
        const previa = await tx.account.findFirst({ where: { userId: usuario.id, provider: "google" }, select: { providerAccountId: true } });
        if (previa) return previa.providerAccountId === cuenta.providerAccountId;
        if (vista.tipo === TIPO_INVITACION_VINCULACION) {
          const consumida = await tx.invitacion.updateMany({
            where: { id: vista.id, estado: "PENDIENTE", rolEmpresa: TIPO_INVITACION_VINCULACION },
            data: { estado: "ACEPTADA", aceptadaEn: ahora, aceptadaPorId: usuario.id },
          });
          if (consumida.count !== 1) return false;
          await registrarCambioAuditado(tx, {
            entidad: "UsuarioEmpresa", entidadId: usuario.id, campo: "cuentaGoogle", descripcion: `Cuenta de Google de "${vista.email}"`,
            valorAnterior: null, valorNuevo: "vinculada", actorId: usuario.id, sucursalId: null,
          });
        }
        await tx.account.create({
          data: {
            userId: usuario.id, type: cuenta.type ?? "oidc", provider: "google", providerAccountId: cuenta.providerAccountId,
            ...(cuenta.access_token != null && { access_token: cuenta.access_token }),
            ...(cuenta.refresh_token != null && { refresh_token: cuenta.refresh_token }),
            ...(cuenta.id_token != null && { id_token: cuenta.id_token }),
            ...(cuenta.expires_at != null && { expires_at: cuenta.expires_at }),
            ...(cuenta.scope != null && { scope: cuenta.scope }),
            ...(cuenta.token_type != null && { token_type: cuenta.token_type }),
            ...(cuenta.session_state != null && { session_state: cuenta.session_state }),
          },
        });
        return true;
      },
      undefined,
      undefined,
      true,
    );
  } catch (e) {
    if (e instanceof InvarianteViolada) return false;
    if (esChoqueDeIndiceUnico(e)) return false;
    throw e;
  }
}
