/**
 * SIN RECETA NO SE VENDE (ADR-033, decisión del dueño del 2026-10-13: «Si quiero que la venta exija receta así no se vende nada sin receta»). Regla FIJA para todo el sistema: no hay
 * interruptor. Un producto de venta (PV) solo se vende si tiene ORIGEN DE STOCK, o sea de dónde sale lo que se descuenta:
 *  - su receta VIGENTE en la sucursal que vende (la efectiva: la propia si la sucursal la tiene habilitada, si no la central; ver `server/lecturas/catalogo/recetas-vigentes.ts`)
 *    con al menos un ingrediente — una reventa (una gaseosa) también: su receta es «1 unidad de la botella»;
 *  - o stock PROPIO (`seProduce`: ya consumió su receta al producirse; la venta resta su stock);
 *  - o es el producto ANCLA de un adicional (ADR-030, D-1): no tiene ni puede tener receta, su consumo es el de su opción (lo verifica el caso de uso antes de llegar acá);
 *  - o (decisión del dueño 2026-10-29) es una LÍNEA con opciones elegidas dentro del precio y esas opciones suman al menos un insumo: el origen de stock es lo que la línea descontaría,
 *    receta base más opciones. Una base sin receta se vende si lo elegido descuenta algo (`opciones.insumos`, los pedidos reales de la línea).
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
  /**
   * Solo en una LÍNEA con opciones elegidas dentro del precio: cuántos insumos pide ese consumo con la base vacía (`insumos`) y los nombres de las opciones elegidas (para el mensaje).
   * En el CATÁLOGO (sin línea: el producto, no una venta) `ofrecidas` es `true`: `insumos` son los que podría sumar alguna opción que el producto ofrece (`insumosQuePuedeSumarAlgunaOpcion`) y
   * el mensaje habla de las opciones en general. Ausente = comportamiento idéntico al de antes (la regla mira solo la receta).
   */
  opciones?: { insumos: number; nombres: readonly string[]; ofrecidas?: boolean };
}

/** El mensaje del rechazo: nombra el producto y dice dónde se arregla. */
export function mensajeProductoSinReceta(nombre: string): string {
  return `«${nombre}» no tiene receta: armala en Catálogo → Recetas para poder venderla.`;
}

/** El mensaje del rechazo de una línea con opciones sobre una base sin receta: nombra las opciones elegidas y dice las dos formas de arreglarlo. */
function mensajeLineaSinInsumos(nombre: string, nombresDeOpciones: readonly string[]): string {
  const con = nombresDeOpciones.map((n) => `“${n}”`).join(" y ");
  return `“${nombre}” con ${con} no descuenta ningún insumo: cargale el consumo a la opción en Catálogo → Biblioteca de opciones, o armá la receta de “${nombre}” en Catálogo → Recetas.`;
}

/** El mensaje de catálogo de un producto sin receta cuyas opciones ofrecidas tampoco descuentan ningún insumo (el espacio del producto y el filtro «le falta: receta»). */
function mensajeSinRecetaNiOpciones(nombre: string): string {
  return `“${nombre}” no tiene receta ni opciones que descuenten insumos: armá la receta o cargale el consumo a sus opciones.`;
}

/** Por qué el PV NO se puede vender (el mensaje), o `null` si tiene origen de stock. */
export function rechazoSinOrigenDeStock(pv: OrigenDeStockDeUnPV): string | null {
  if (pv.seProduce || pv.esAnclaDeAdicional || pv.ingredientesDeLaRecetaVigente > 0) return null;
  if (pv.opciones !== undefined) {
    if (pv.opciones.insumos > 0) return null;
    if (pv.opciones.ofrecidas) return mensajeSinRecetaNiOpciones(pv.nombre);
    if (pv.opciones.nombres.length > 0) return mensajeLineaSinInsumos(pv.nombre, pv.opciones.nombres);
  }
  return mensajeProductoSinReceta(pv.nombre);
}
