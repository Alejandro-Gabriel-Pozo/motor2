import "server-only";
import { enviarCorreo } from "@/lib/enviar-correo";
import { enlaceDeInvitacion, mensajeDeInvitacionDeUsuario, mensajeDeInvitacionDeVinculacion, urlPublicaDeLaApp, type TipoDeInvitacion } from "@/core/features/empresa/invitacion";
import type { PrismaClient } from "@prisma/client";
import { reportarErrorUnaVez } from "@/lib/reportar-error";
import { anotarInvitacionEnviada } from "@/server/persistencia/invitaciones/anotar-invitacion-enviada";

/**
 * Mandar el mail de una invitación de usuario o de vinculación (E8, ADR-024). El mail sale SIEMPRE después del commit de la transacción que dejó la invitación (ADR-018): la
 * transacción puede reintentarse y un mail no se retira. Quien llama pasa el token que devolvieron los helpers de transacción (en la base solo está su hash).
 *
 * El enlace se arma con `AUTH_URL` (la dirección pública fija de la app, ADR-007), NUNCA con el encabezado `Host`. Si el mail no sale, la invitación queda hecha y sin la marca
 * de envío (`enviadaEn` nulo): la pantalla lo muestra y se reenvía.
 */
export interface InvitacionPorEnviar {
  invitacionId: string;
  token: string;
  tipo: Extract<TipoDeInvitacion, "usuario" | "vinculacion">;
}

export interface ResultadoDelEnvio {
  enviado: boolean;
  /** Por qué no salió, para quien invita (sin datos del proveedor). */
  motivo?: string;
}

/**
 * Paso «mandar el mail de la invitación y anotar el envío» (Hito 3, Fase I, I.5f de `docs/plan-hito-3-pureza.md`): antes vivía en `src/server/invitaciones-de-usuario.ts`,
 * mudado TAL CUAL (mismo nombre y firma, mismas lecturas y en el mismo orden, mismos mensajes); la única escritura —la marca `enviadaEn`, condicional a que la invitación siga
 * PENDIENTE— pasó a `server/persistencia/invitaciones/anotar-invitacion-enviada.ts`. Lo llama la Server Action de `usuarios.ts` DESPUÉS de que el caso de uso (o la transacción de
 * gobierno) confirmó la invitación, con el `ctx.db` de la empresa: nunca dentro de una transacción que pueda reintentarse.
 *
 * Como la Server Action lo importa de esta carpeta, el descubrimiento de casos de uso lo trata como uno (y está bien: es el efecto externo de la alta, el reenvío y la invitación
 * a vincular): lleva su ficha. No devuelve un `ResultadoCaso` sino si el mail salió: la acción arma el mensaje final con eso (`SIN_ENVOLTORIO_TODAVIA`, con su motivo).
 *
 * @contract Manda el mail de la invitación pendiente (con el enlace de AUTH_URL y el token recibido) y, si salió, anota cuándo; si no hay AUTH_URL válida, la invitación ya no está pendiente o el proveedor falla, no anota y dice por qué.
 * @idempotency No aplica — repetirlo manda otro mail con el mismo token y vuelve a anotar la hora; quien reenvía de verdad (con token nuevo) es `reenviarInvitacionPendiente`, con su freno de un minuto.
 * @transaction Ninguna: dos lecturas y, después del mail, una escritura condicional (`estado = PENDIENTE`) con el cliente de la empresa, fuera de toda transacción (el mail no se puede deshacer).
 * @sideEffects enviarCorreo (canal «avisos»); reportarErrorUnaVez si falta AUTH_URL. La marca `enviadaEn` es el registro del envío en la propia invitación (sin fila de auditoría).
 * @ficha permiso=gestion_usuarios transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function enviarInvitacionYAnotar(
  dbEmpresa: PrismaClient,
  entrada: { empresaId: string; emailDeQuienInvita: string; ahora: Date; autUrl?: string | undefined } & InvitacionPorEnviar,
): Promise<ResultadoDelEnvio> {
  const base = urlPublicaDeLaApp(entrada.autUrl ?? process.env.AUTH_URL);
  if (!base) {
    await reportarErrorUnaVez("invitacion-sin-auth-url", new Error("No se pudo armar el enlace de una invitación: AUTH_URL falta o no es una dirección pública válida."), "invitaciones");
    return { enviado: false, motivo: "La aplicación no tiene configurada su dirección pública (AUTH_URL)." };
  }

  const invitacion = await dbEmpresa.invitacion.findFirst({
    where: { id: entrada.invitacionId, empresaId: entrada.empresaId, estado: "PENDIENTE" },
    select: { email: true, venceEn: true, sucursales: { orderBy: { creadaEn: "asc" }, select: { sucursal: { select: { nombre: true } }, rol: { select: { nombre: true } } } } },
  });
  const empresa = await dbEmpresa.empresa.findUnique({ where: { id: entrada.empresaId }, select: { nombre: true, zonaHoraria: true } });
  if (!invitacion || !empresa) return { enviado: false, motivo: "La invitación ya no está pendiente." };

  const enlace = enlaceDeInvitacion(base, entrada.token);
  const mensaje =
    entrada.tipo === "usuario"
      ? mensajeDeInvitacionDeUsuario({
          email: invitacion.email,
          nombreEmpresa: empresa.nombre,
          emailDeQuienInvita: entrada.emailDeQuienInvita,
          accesos: invitacion.sucursales.map((s) => ({ sucursal: s.sucursal.nombre, rol: s.rol.nombre })),
          enlace,
          venceEn: invitacion.venceEn,
          zonaHoraria: empresa.zonaHoraria,
        })
      : mensajeDeInvitacionDeVinculacion({ email: invitacion.email, nombreEmpresa: empresa.nombre, enlace, venceEn: invitacion.venceEn, zonaHoraria: empresa.zonaHoraria });

  const resultado = await enviarCorreo("avisos", mensaje);
  if (!resultado.ok) return { enviado: false, motivo: "No se pudo enviar el mail." };
  await anotarInvitacionEnviada(dbEmpresa, { invitacionId: entrada.invitacionId, ahora: entrada.ahora });
  return { enviado: true };
}
