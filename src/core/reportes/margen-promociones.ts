/**
 * Reporte de margen real de las promos ARMABLES (Task #16, docs/plan-promo-combo-2026-09-26.md, paso 12): por cada promo de
 * carta, cuánto entró de verdad (prorrateado, D3) contra lo que hubiera entrado si cada componente se hubiera vendido SUELTO
 * a precio de carta — y el margen Real de las dos formas, con el MISMO costo real (una promo no cambia lo que cuesta hacerla,
 * solo lo que se cobra por ella).
 *
 * Fuente: `MovimientoStock` de proceso VENTA cuya `Operacion.promoCuentaId` no es nulo (una línea por COMPONENTE, igual
 * criterio que `descuentos-clientes.ts` para `clienteId`) — el precio COBRADO ya prorrateado está en `precioTotal` (sin
 * tocar acá: nada de esta Task cambió su significado). El precio A LISTA de cada componente es `CuentaItem.
 * precioCartaUnitario` (paso 6): como no hay una columna propia en `MovimientoStock` para esto (a diferencia de
 * `precioListaUnitario`, que es del descuento de cliente, un concepto distinto — D2: los dos conviven, el descuento se aplica
 * DESPUÉS de prorratear), se lee de `CuentaItem` uniendo por `operacionId` (1 a 1: `registrar-venta.ts` crea una Operacion
 * por línea neta, ver su docstring).
 *
 * Se agrupa por `PromoCarta` (el TIPO de promo, ej. "Menú del día"), no por instancia (`PromoCuenta`, cada venta armada
 * puntual): un local vende la misma promo muchas veces, y lo que importa acá es cómo le va a esa promo en el período, igual
 * criterio que Período/Costos agrupan por producto y no por línea de venta. `costoPorItem` de `margen-real.ts` (paso 2, UNA
 * sola pasada para TODOS los componentes de TODAS las promos) es lo que hace posible este agrupamiento sin volver a costear
 * nada: el costo real de cada componente es el MISMO sea cual sea el precio con el que se lo empareje (cobrado o a lista),
 * así que se ahorra la doble pasada que sí necesita `descuentos-clientes.ts` (ahí hacen falta dos llamados porque, además de
 * la resta de precios, necesita los totales propios de cada pasada).
 *
 * El título mostrado es el de `PromoCarta.titulo` ACTUAL (no el snapshot congelado en cada `PromoCuenta.titulo`): mismo
 * criterio que un producto renombrado en Período/Costos, que muestra el nombre de HOY del catálogo, no el de cuando se
 * vendió. Una promo que se dio de baja (`activa: false`) sigue apareciendo si vendió algo en el rango, marcada como tal —
 * no se pierde el historial de lo que ya se cobró.
 */

export interface FilaMargenPromocion {
  promoCartaId: string;
  titulo: string;
  /** La `PromoCarta` sigue activa HOY (no en el momento de la venta) — una dada de baja sigue en el reporte si vendió algo. */
  activa: boolean;
  /** Instancias distintas de `PromoCuenta` vendidas en el rango (una por cada vez que se armó y se cobró esta promo). */
  cantidadInstancias: number;
  /** Líneas de componente netas (una por producto+precio de cada instancia — ver el docstring del módulo). */
  cantidadComponentes: number;
  ingresoALista: number;
  ingresoCobrado: number;
  /** `ingresoALista - ingresoCobrado`, exacto (aritmética de precios, no depende de ningún costo): lo que el cliente se
   *  ahorró por llevar el combo en vez de pedir cada cosa suelta. */
  ahorroCliente: number;
  ahorroClientePct: number | null;
  /** Margen Real sobre lo COBRADO (lo que de verdad entró prorrateado) — `null` si ninguna venta se pudo costear. */
  margenReal: number | null;
  margenRealPct: number | null;
  /** Margen Real que hubiera dado la MISMA venta si cada componente se hubiese cobrado a precio de carta (mismo costo real):
   *  para ver si el precio de la promo deja un margen sano o le come demasiado a la venta suelta equivalente. */
  margenRealSueltoEquivalente: number | null;
  margenRealSueltoEquivalentePct: number | null;
  /** Algún componente de esta promo se costeó con el historial de compras (no se guardó al vender). */
  margenRealReconstruido: boolean;
  /** `false` si algún componente de esta promo quedó afuera del margen Real — el número no cubre el 100% de lo vendido. */
  margenRealCompleto: boolean;
}

export interface ReporteMargenPromociones {
  desde: Date;
  hasta: Date;
  cantidadInstancias: number;
  ingresoALista: number;
  ingresoCobrado: number;
  ahorroCliente: number;
  promos: FilaMargenPromocion[];
  aviso: string;
}

export interface AcumuladoPromo {
  titulo: string;
  instancias: Set<string>;
  cantidadComponentes: number;
  ingresoALista: number;
  ingresoCobrado: number;
  /** Solo de los componentes que SÍ se pudieron costear — base para el margen Real (misma idea que `ingresoConCostoReal`). */
  ingresoAListaConCosto: number;
  ingresoCobradoConCosto: number;
  costoRealTotal: number;
  reconstruido: boolean;
  completo: boolean;
}