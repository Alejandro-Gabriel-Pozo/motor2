import "server-only";
import { enviarCorreo } from "@/core/correo/enviar";
import { enlaceDeInvitacion, mensajeDeInvitacionDeUsuario, mensajeDeInvitacionDeVinculacion, urlPublicaDeLaApp, type TipoDeInvitacion } from "@/core/features/empresa/invitacion";
import type { PrismaClient } from "@prisma/client";
import { reportarErrorUnaVez } from "@/lib/reportar-error";

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
  await dbEmpresa.invitacion.updateMany({ where: { id: entrada.invitacionId, estado: "PENDIENTE" }, data: { enviadaEn: entrada.ahora } });
  return { enviado: true };
}
