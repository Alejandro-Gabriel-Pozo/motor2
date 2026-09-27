import { esNumeroFinito } from "@/core/numero";
import { redondearACantidadDeUnidad } from "@/core/movimientos/transiciones";
import { cumplePaso, mensajeCantidadNoCumplePaso } from "@/core/catalogo/venta-fraccionada";

/**
 * Validación de la cantidad de un ítem al tomar el pedido (o al anularlo) — PURA, sin Prisma (docs/plan-pos-agregar-varios-2026-09-26.md).
 * Vive separada de `src/core/pos/cuenta.ts` (que importa `@/lib/db` a nivel de módulo: un cliente NUNCA puede importarlo, ni
 * siquiera solo para estas dos funciones/constantes) para que la lista «Por agregar» del POS (`agregar-items.tsx`,
 * `agregar-lista-estado.ts`) pueda normalizar cada línea con la MISMA función que usa el servidor (`agregarItems`,
 * `src/server/actions/pos/cuenta-pedido.ts`) antes de confirmar — así lo que se ve en pantalla es lo que se va a guardar, sin redondeo
 * silencioso. `cuenta.ts` re-exporta ambas para no romper a quien ya las importaba de ahí.
 */

export const CANTIDAD_MAXIMA_POR_ITEM = 999;

/** Cuántos ítems (productos DISTINTOS) admite un solo `agregarItems`: mismo tope en el cliente (deshabilitar sumar el #51) y el servidor. */
export const MAXIMO_ITEMS_POR_AGREGADO = 50;

export interface PasoDeVentaPedido {
  /** `Producto.pasoVenta` — `null`/`undefined` es EXACTAMENTE lo mismo que no pasar este tercer parámetro (redondeo de siempre). */
  pasoVenta: number | null | undefined;
  /** `tieneStockReal(producto.tipo, producto.seProduce)` (`core/movimientos/transiciones.ts`) — ver el docstring de R3 en
   *  `core/catalogo/venta-fraccionada.ts`. Con `pasoVenta` puesto y stock real, R3 ya garantiza que el paso entra en `decimales`
   *  (se valida al configurarlo, `validarPasoVenta`) — acá solo decide si igual se aplica el redondeo a `decimales` como red de
   *  seguridad (idempotente en ese caso) o si, sin stock real, se lo salta para no arruinar una fracción más fina que `decimales`. */
  tieneStockReal: boolean;
}

/**
 * Cantidad de un ítem al tomar el pedido (o al anularlo): número finito, mayor que cero y hasta 999.
 *
 * Sin tercer parámetro (o con `pasoVenta` null/undefined): comportamiento IDÉNTICO a como era antes de la venta fraccionada — se
 * redondea a los decimales que acepta la unidad de stock del producto (igual que entra al Kardex); si el redondeo la deja en
 * cero, tampoco sirve (Task #25 deja esto EXACTAMENTE igual, ver test/pos/cuenta.test.ts y test/pos/cuenta-action.test.ts).
 *
 * Con `pasoVenta` puesto (Task #25, docs/plan-venta-fraccionada-2026-09-26.md): la cantidad tiene que ser un múltiplo EXACTO del
 * paso — si no lo es, se RECHAZA (nunca se redondea en silencio, a diferencia del camino de arriba). Aceptada, NO se redondea a
 * `decimales` salvo que el producto tenga stock real (`tieneStockReal`): sin stock real (el caso común, "se cocina al momento"),
 * redondear a `decimales` arruinaría la fracción en una unidad de pocos decimales (ej. 0,5 en una unidad "unidad", 0 decimales)
 * — la limpieza de ruido de punto flotante alcanza con los 4 decimales de la columna (`Decimal(14,4)`).
 */
export function validarCantidadPedido(
  cantidad: unknown,
  decimales: number,
  paso?: PasoDeVentaPedido | null
): { ok: true; cantidad: number } | { ok: false; mensaje: string } {
  const n = typeof cantidad === "number" ? cantidad : Number.NaN;
  if (!(n > 0) || !esNumeroFinito(n)) return { ok: false, mensaje: "La cantidad tiene que ser un número mayor que cero." };
  if (n > CANTIDAD_MAXIMA_POR_ITEM) return { ok: false, mensaje: `La cantidad no puede superar ${CANTIDAD_MAXIMA_POR_ITEM}.` };

  if (paso?.pasoVenta) {
    if (!cumplePaso(n, paso.pasoVenta)) return { ok: false, mensaje: mensajeCantidadNoCumplePaso(paso.pasoVenta) };
    const cantidadFinal = redondearACantidadDeUnidad(n, paso.tieneStockReal ? decimales : 4);
    if (!(cantidadFinal > 0)) return { ok: false, mensaje: "La cantidad tiene que ser un número mayor que cero." };
    return { ok: true, cantidad: cantidadFinal };
  }

  const redondeada = redondearACantidadDeUnidad(n, decimales);
  if (!(redondeada > 0)) return { ok: false, mensaje: "La cantidad tiene que ser un número mayor que cero." };
  return { ok: true, cantidad: redondeada };
}
