/**
 * SIN RECETA NO SE VENDE (ADR-033, decisión del dueño del 2026-10-13: «Si quiero que la venta exija receta así no se vende nada sin receta»). Regla FIJA para todo el sistema: no hay
 * interruptor. Un producto de venta (PV) solo se vende si tiene ORIGEN DE STOCK, o sea de dónde sale lo que se descuenta:
 *  - su receta VIGENTE en la sucursal que vende (la efectiva: la propia si la sucursal la tiene habilitada, si no la central; ver `server/lecturas/catalogo/recetas-vigentes.ts`)
 *    con al menos un ingrediente — una reventa (una gaseosa) también: su receta es «1 unidad de la botella»;
 *  - o stock PROPIO (`seProduce`: ya consumió su receta al producirse; la venta resta su stock);
 *  - o es el producto ANCLA de un adicional (ADR-030, D-1): no tiene ni puede tener receta, su consumo es el de su opción (lo verifica el caso de uso antes de llegar acá).
 * Puro (P0): sin lectura ni escritura, solo el criterio y el texto. Lo llaman el agregado de ítems del POS (el error temprano para el mozo, `agregar-items.ts`) y `armarLinea` (la barrera
 * final del cierre de cuenta y de la venta de mostrador, `registrar-venta-en-tx.ts`), cada uno con la receta que ya leyó.
 */

/** El código tipado del rechazo (`fracaso`): lo devuelven el agregado de ítems, el cierre de cuenta y la venta de mostrador. */
export const CODIGO_PRODUCTO_SIN_RECETA = "PRODUCTO_SIN_RECETA" as const;

/** Lo que la regla mira de un PV: su nombre (para el mensaje), si se produce, si es el ancla verificada de un adicional y cuántos ingredientes tiene su receta vigente en la sucursal. */
export interface OrigenDeStockDeUnPV {
  nombre: string;
  seProduce: boolean;
  esAnclaDeAdicional: boolean;
  ingredientesDeLaRecetaVigente: number;
}

/** El mensaje del rechazo: nombra el producto y dice dónde se arregla. */
export function mensajeProductoSinReceta(nombre: string): string {
  return `«${nombre}» no tiene receta: armala en Catálogo → Recetas para poder venderla.`;
}

/** Por qué el PV NO se puede vender (el mensaje), o `null` si tiene origen de stock. */
export function rechazoSinOrigenDeStock(pv: OrigenDeStockDeUnPV): string | null {
  if (pv.seProduce || pv.esAnclaDeAdicional || pv.ingredientesDeLaRecetaVigente > 0) return null;
  return mensajeProductoSinReceta(pv.nombre);
}
