import "server-only";
import { MENSAJE_EXCEDE_LA_ORDEN_BLOQUEADA, MENSAJE_EXCEDE_LA_ORDEN_SIN_CONFIRMAR, MENSAJE_VINCULO_ORDEN_NO_PEDIDA } from "@/core/compras/public";

/** Los únicos rechazos que la base decide por su cuenta (carrera): el tope del control de exceso y que la orden ya no esté pedida. */
export type CodigoDeRechazoDeOrdenDeLaBase = "EXCEDE_LA_ORDEN_BLOQUEADA" | "EXCEDE_LA_ORDEN_SIN_CONFIRMAR" | "ORDEN_NO_PEDIDA";

/**
 * Compras, orden de compra: traduce lo que rechaza la BASE (los disparadores de la migración 20261117130000, que repiten las reglas del caso de uso como segunda barrera y deciden la carrera) a un rechazo de negocio. Los disparadores levantan
 * una excepción con SQLSTATE 23514 y el nombre de la restricción en `CONSTRAINT`; el adaptador de Prisma la entrega con ese nombre en el texto del error o de su causa. Solo se reconocen los nombres de la lista: cualquier otro error se vuelve a lanzar.
 */

const RECHAZOS: Readonly<Record<string, { codigo: CodigoDeRechazoDeOrdenDeLaBase; mensaje: string }>> = {
  recepcion_excede_la_orden_bloqueada: { codigo: "EXCEDE_LA_ORDEN_BLOQUEADA", mensaje: MENSAJE_EXCEDE_LA_ORDEN_BLOQUEADA },
  recepcion_excede_la_orden_sin_confirmar: { codigo: "EXCEDE_LA_ORDEN_SIN_CONFIRMAR", mensaje: MENSAJE_EXCEDE_LA_ORDEN_SIN_CONFIRMAR },
  orden_no_pedida: { codigo: "ORDEN_NO_PEDIDA", mensaje: MENSAJE_VINCULO_ORDEN_NO_PEDIDA },
};

/** Todas las cadenas de texto del error y de su causa (mensaje, restricción, mensaje original): donde el nombre de la restricción puede aparecer según el adaptador. */
function textosDelError(e: unknown, profundidad = 0): string[] {
  if (profundidad > 4 || e === null || e === undefined) return [];
  if (typeof e === "string") return [e];
  if (typeof e !== "object") return [];
  const o = e as Record<string, unknown>;
  const propias = ["message", "originalMessage", "constraint", "detail", "meta"].flatMap((k) => {
    const v = o[k];
    if (typeof v === "string") return [v];
    if (v && typeof v === "object") return textosDelError(v, profundidad + 1);
    return [];
  });
  return [...propias, ...textosDelError(o.cause, profundidad + 1)];
}

/** El rechazo de negocio que corresponde a un error de la base del control de exceso (o de que la orden ya no está pedida), o `null` si es otro error. */
export function rechazoDeOrdenDeLaBase(e: unknown): { codigo: CodigoDeRechazoDeOrdenDeLaBase; mensaje: string } | null {
  const textos = textosDelError(e).join("\n");
  for (const [nombre, rechazo] of Object.entries(RECHAZOS)) if (textos.includes(nombre)) return rechazo;
  return null;
}
