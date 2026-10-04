import type { EstadoEfectivoDeInvitacion } from "@/core/features/empresa/invitacion";
import type { FilaDeEmpresa } from "../../servidor/empresas";

export const ESTADO_DE_EMPRESA: Record<FilaDeEmpresa["estado"], string> = {
  PROVISIONING: "En alta",
  ACTIVE: "Activa",
  SUSPENDED: "Suspendida",
  DELETING: "En baja",
};

export const ESTADO_DE_INVITACION: Record<EstadoEfectivoDeInvitacion, string> = {
  PENDIENTE: "Pendiente",
  ACEPTADA: "Aceptada",
  REVOCADA: "Revocada",
  VENCIDA: "Vencida",
};

/** «04/10/2026 12:00» en hora de Buenos Aires: la consola la usan personas de acá y la fecha es solo orientativa (el vencimiento real lo decide la base). */
export function fechaCorta(fecha: Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(fecha);
}
