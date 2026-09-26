import { esNumeroFinito } from "@/core/numero";
import { redondearACantidadDeUnidad } from "@/core/movimientos/transiciones";

/**
 * Validación de la cantidad de un ítem al tomar el pedido (o al anularlo) — PURA, sin Prisma (docs/plan-pos-agregar-varios-2026-09-26.md).
 * Vive separada de `src/core/pos/cuenta.ts` (que importa `@/lib/db` a nivel de módulo: un cliente NUNCA puede importarlo, ni
 * siquiera solo para estas dos funciones/constantes) para que la lista «Por agregar» del POS (`agregar-items.tsx`,
 * `agregar-lista-estado.ts`) pueda normalizar cada línea con la MISMA función que usa el servidor (`agregarItems`,
 * `src/server/actions/pos/cuenta.ts`) antes de confirmar — así lo que se ve en pantalla es lo que se va a guardar, sin redondeo
 * silencioso. `cuenta.ts` re-exporta ambas para no romper a quien ya las importaba de ahí.
 */

export const CANTIDAD_MAXIMA_POR_ITEM = 999;

/** Cuántos ítems (productos DISTINTOS) admite un solo `agregarItems`: mismo tope en el cliente (deshabilitar sumar el #51) y el servidor. */
export const MAXIMO_ITEMS_POR_AGREGADO = 50;

/**
 * Cantidad de un ítem al tomar el pedido (o al anularlo): número finito, mayor que cero y hasta 999, redondeada a los decimales que
 * acepta la unidad de stock del producto (igual que entra al Kardex). Si el redondeo la deja en cero, tampoco sirve.
 */
export function validarCantidadPedido(cantidad: unknown, decimales: number): { ok: true; cantidad: number } | { ok: false; mensaje: string } {
  const n = typeof cantidad === "number" ? cantidad : Number.NaN;
  if (!(n > 0) || !esNumeroFinito(n)) return { ok: false, mensaje: "La cantidad tiene que ser un número mayor que cero." };
  if (n > CANTIDAD_MAXIMA_POR_ITEM) return { ok: false, mensaje: `La cantidad no puede superar ${CANTIDAD_MAXIMA_POR_ITEM}.` };
  const redondeada = redondearACantidadDeUnidad(n, decimales);
  if (!(redondeada > 0)) return { ok: false, mensaje: "La cantidad tiene que ser un número mayor que cero." };
  return { ok: true, cantidad: redondeada };
}
