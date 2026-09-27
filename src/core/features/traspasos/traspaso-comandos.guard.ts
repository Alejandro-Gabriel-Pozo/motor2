import { texto } from "@/core/texto";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoAprobarYEnviarTraspaso, ComandoCancelarSolicitudTraspaso, ComandoRechazarSolicitudTraspaso } from "./traspaso.schema";

/**
 * Guards de los COMANDOS de traspasos (Task #41, Fase M11a — docs/arquitectura-casos-de-uso-2026-09-27.md): formato, ANTES de abrir la
 * transacción. Puros: sin Prisma ni permisos. Viven aparte de `traspaso.guard.ts` (el guard de TRANSICIÓN de estado, que decide contra
 * el traspaso ya leído y lo sigue usando el caso de uso dentro de la transacción).
 *
 * Los mensajes son EXACTAMENTE los que devolvían las Server Actions de `src/server/actions/traspasos/traspasos.ts` antes de la
 * migración, y el id se normaliza igual que entonces (`texto(id)`: recorta espacios y convierte lo que llegue a string).
 */

/** Mismo texto que usaban las Server Actions de la Bandeja cuando el id del traspaso llega vacío. */
export const MENSAJE_FALTA_TRASPASO = "Falta el traspaso.";

/** Mismo texto que usaba `aprobarYEnviarTransferencia` cuando la sección de origen no es de esta sucursal. */
export const MENSAJE_SECCION_ORIGEN_NO_PROPIA = "Elegí de qué sección propia sale.";

/** Mismo texto que usaban las Server Actions cuando no existe un traspaso con ese id. */
export const MENSAJE_TRASPASO_NO_ENCONTRADO = "No se encontró ese traspaso.";

function idDeTraspaso(id: unknown): ResultadoDato<string> {
  const traspasoId = texto(id);
  return traspasoId ? aceptar(traspasoId) : rechazar("vacio", MENSAJE_FALTA_TRASPASO);
}

/**
 * Guard del comando «aprobar y enviar una solicitud». Primero el id (como antes); después la sección: si no es un string, el MISMO
 * mensaje que «no es una sección propia» (antes llegaba así al `findUnique` y Prisma la rechazaba con un error crudo de validación —
 * un 500 para la pantalla). Un string —exista o no, sea de esta sucursal o no— pasa tal cual: eso lo decide el caso de uso.
 */
export function guardComandoAprobarYEnviarTraspaso(entrada: unknown): ResultadoDato<ComandoAprobarYEnviarTraspaso> {
  const { id, seccionOrigenId } = (entrada ?? {}) as { id?: unknown; seccionOrigenId?: unknown };
  const traspasoId = idDeTraspaso(id);
  if (!traspasoId.ok) return traspasoId;
  if (typeof seccionOrigenId !== "string") return rechazar("formato", MENSAJE_SECCION_ORIGEN_NO_PROPIA);
  return aceptar({ traspasoId: traspasoId.valor, seccionOrigenId });
}

/** Guard del comando «cancelar mi propia solicitud»: solo el id. */
export function guardComandoCancelarSolicitudTraspaso(entrada: unknown): ResultadoDato<ComandoCancelarSolicitudTraspaso> {
  const { id } = (entrada ?? {}) as { id?: unknown };
  const traspasoId = idDeTraspaso(id);
  if (!traspasoId.ok) return traspasoId;
  return aceptar({ traspasoId: traspasoId.valor });
}

/** Guard del comando «rechazar una solicitud»: el id, y el motivo normalizado como antes (`texto(motivo) || null`). */
export function guardComandoRechazarSolicitudTraspaso(entrada: unknown): ResultadoDato<ComandoRechazarSolicitudTraspaso> {
  const { id, motivo } = (entrada ?? {}) as { id?: unknown; motivo?: unknown };
  const traspasoId = idDeTraspaso(id);
  if (!traspasoId.ok) return traspasoId;
  return aceptar({ traspasoId: traspasoId.valor, motivo: texto(motivo) || null });
}
