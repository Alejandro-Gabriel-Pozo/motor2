import { type AccionFaltante } from "./accion-faltante";
import { type AntiguedadSerieIPC } from "./indices-economicos";

export interface FilaMargenProducto {
  productoId: string;
  producto: string;
  cantidad: number;
  ingreso: number;
  ingresoEstimado: boolean;
  costoUnitario: number | null;
  costo: number | null;
  costoIncompleto: boolean;
  /** docs/comparativa-ux-erpnext-dolibarr.md §7.1 — mismo criterio causa→acción que ya usaba Costos, ahora compartido. `null` si no falta nada. */
  accionFaltante: AccionFaltante | null;
  margen: number | null;
  margenPct: number | null;
  /**
   * Margen "Real" de ESTE producto (mismo criterio línea a línea que
   * `margenRealTotal` del reporte: costo congelado al vender, o
   * reconstruido con el historial de compras) — fuente única para
   * cualquier consumidor (Período, Promociones), en vez de que cada uno
   * recalcule el suyo. `null` si ninguna venta de este producto en el
   * rango se pudo costear.
   */
  margenReal: number | null;
  margenRealPct: number | null;
  /** Parte de `ingreso` de este producto cuyo costo se reconstruyó (no se guardó al vender) — 0 si ninguna o si `margenReal` es `null`. */
  ingresoRealReconstruido: number;
  /** `false` si alguna venta de este producto quedó afuera de `margenReal` por no poderse costear — la cobertura no es total. */
  margenRealCompleto: boolean;
}
export interface MargenDelPeriodo {
  ingresoTotal: number;
  costoTotal: number;
  margenTotal: number;
  margenPctTotal: number | null;
  hayCostoIncompleto: boolean;
  porProducto: FilaMargenProducto[];
  aviso: string;
  /**
   * "Margen real" (docs/comparativa-ux-erpnext-dolibarr.md §9 y su «Segunda pasada») — a diferencia de margenTotal (receta/costo de
   * HOY aplicados a TODO lo vendido en el rango), esto suma, línea por línea, el costo de cada venta al día de la venta:
   * - si la venta guardó su costo (MovimientoStock.costoUnitarioVenta, ventas cargadas desde la aplicación), ese costo congelado manda;
   * - si no lo guardó, se RECONSTRUYE con el historial de compras (costo-historico.ts: receta de hoy × precio de la compra más
   *   reciente de cada insumo hasta ese día). `ingresoRealReconstruido` es cuánto del ingreso se costeó así (aproximación).
   * `ingresoSinCostoReal` es cuánto quedó afuera por no poderse costear (algún insumo sin compras hasta ese día, o el plato sin
   * receta). `null` si NINGUNA venta del rango se pudo costear.
   */
  margenRealTotal: number | null;
  margenRealPctTotal: number | null;
  ingresoConCostoReal: number;
  ingresoSinCostoReal: number;
  /** Parte de `ingresoConCostoReal` cuyo costo se RECONSTRUYÓ con el historial de compras (la venta no lo guardó al venderse). */
  ingresoRealReconstruido: number;
  avisoReal: string;
  /** Ventas cargadas SIN precio (`precioTotal` en 0) que quedaron afuera del margen Real y del costo de lo vendido: no tienen un ingreso con qué compararse. */
  ventasSinPrecioExcluidas: number;
  /**
   * «Costo de lo vendido (consumo)» (6b): lo que costó, en total, lo que efectivamente se vendió en el rango — el costo congelado al vender (o el
   * reconstruido con el historial de compras) de cada línea COSTEABLE, no lo que se compró. Es el numerador del food cost real; su denominador es
   * `ingresoConCostoReal` (lo vendido que se pudo costear), NUNCA `ingresoTotal`: mezclarlos daría un porcentaje artificialmente bajo, porque el
   * numerador solo cubre una parte de las ventas. Se cumple `costoDeLoVendidoTotal ≈ ingresoConCostoReal − margenRealTotal` (cada número se redondea por
   * separado). `null` si NINGUNA venta del rango se pudo costear.
   *
   * A diferencia del ratio Compras/Ventas (desembolso), INCLUYE el packaging y la limpieza que estén en la receta: `costoUnitarioVenta` guarda el costo
   * total del plato. Por eso los dos números no son comparables al centavo, y el aviso lo dice.
   */
  costoDeLoVendidoTotal: number | null;
  /** `costoDeLoVendidoTotal / ingresoConCostoReal`, en %. */
  costoDeLoVendidoPctTotal: number | null;
  /**
   * Qué parte de lo vendido se pudo costear: `ingresoConCostoReal / (ingresoConCostoReal + ingresoSinCostoReal)`. La base NO es `ingresoTotal`: ese incluye las
   * ventas viejas sin precio valorizadas al precio vigente (estimado), que acá ni siquiera entran. `null` si no hay ventas costeables ni sin costear.
   */
  coberturaCostoRealPct: number | null;
  avisoCostoDeLoVendido: string;
  /**
   * "Margen ajustado por IPC" (Método 1, docs/comparativa-ux-erpnext-
   * dolibarr.md §10) — lleva el ingreso de cada venta a poder adquisitivo
   * del último mes con IPC cargado (`indices-economicos.ts`) ANTES de
   * restarle el costo de HOY (el mismo costoPorProducto que usa
   * margenTotal, a propósito: acá los dos lados de la resta quedan en la
   * misma "moneda" — plata de hoy — a diferencia de margenTotal, que
   * mezcla ingreso histórico nominal con costo de hoy). A diferencia de
   * margenRealTotal, SÍ es retroactivo — el INDEC tiene el índice de
   * cualquier mes pasado — pero depende de que ese mes ya esté
   * sincronizado (`sincronizarIPC`) y de que el producto tenga costo
   * completo hoy. `ingresoSinIPC` es cuánto del ingreso del rango quedó
   * afuera (mes sin IPC publicado/sincronizado, o costo incompleto).
   */
  margenIPCTotal: number | null;
  margenIPCPctTotal: number | null;
  ingresoAjustadoIPCTotal: number;
  ingresoConIPC: number;
  ingresoSinIPC: number;
  /** Cuánto del ingreso con IPC es de un mes que el INDEC todavía no publicó (coeficiente provisorio). */
  ingresoProvisorioIPC: number;
  avisoIPC: string;
  /** Cuán vieja es la serie del IPC (5c). Con `vencida` el ajuste está en plata del último mes cargado, no de hoy. */
  antiguedadIPC: AntiguedadSerieIPC;
}