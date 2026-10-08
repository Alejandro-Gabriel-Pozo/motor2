import { validarOrdenCarta } from "@/core/carta/public";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoActualizarOrdenOpcionItemAgrupadoCarta } from "./items-agrupados.schema";

/**
 * Guard de la feature «ítems agrupados de la carta» (convención «guard por feature», 2026-09-25; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Formato del
 * comando, ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa("carta_items_agrupados", …)`, así que el rechazo por permiso sigue
 * llegando antes que el de formato. Puro: sin Prisma ni permisos.
 *
 * Solo las acciones cuyas validaciones iban TODAS antes de la primera lectura tienen guard: acá `actualizarOrdenOpcionItemAgrupadoCarta` (el orden va antes de
 * buscar la opción, así que un orden roto gana sobre «no se encontró»). Apagar o prender, agregar una opción (lee el ítem antes de mirar el producto) y quitar una
 * opción quedan sin guard (`SIN_GUARD` con motivo).
 */

/** Guard del comando «cambiar el orden de una opción»: EXACTAMENTE `validarOrdenCarta`, con su mismo texto (vacío o null valen 0). El `opcionId` pasa tal cual (lo resuelve el caso de uso). */
export function guardComandoActualizarOrdenOpcionItemAgrupadoCarta(entrada: { opcionId: string; orden: unknown }): ResultadoDato<ComandoActualizarOrdenOpcionItemAgrupadoCarta> {
  const orden = validarOrdenCarta(entrada.orden);
  if (!orden.ok) return rechazar("formato", orden.mensaje);
  return aceptar({ opcionId: entrada.opcionId, orden: orden.valor });
}
