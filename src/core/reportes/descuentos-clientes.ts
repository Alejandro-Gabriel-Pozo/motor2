/**
 * Reporte de descuentos por cliente (Task #14, docs/plan-clientes-descuento-2026-09-26.md, punto 10 — último del plan): cuánto se
 * "regaló" en el período, por cliente, y si ese descuento se comió el margen. Fuente: `MovimientoStock` de proceso VENTA con
 * `Operacion.clienteId` no nulo (asignado desde `asignarClienteACuenta`) — el precio COBRADO ya está en `precioTotal`/
 * `precioPorUnidadStock` (los mismos campos de siempre: nada de esta Task cambió su significado), y el de LISTA en
 * `precioListaUnitario` cuando el descuento hizo que difiriera (`null` en una línea de un cliente con 0% de descuento).
 *
 * Margen COBRADO vs. margen A LISTA: se costea la MISMA venta dos veces con `calcularMargenRealDelPeriodo` (src/core/reportes/
 * margen-real.ts, el motor extraído de Período en el punto 8 de este mismo plan) — una con el precio cobrado (de siempre) y otra
 * con el de lista —, así el costo real de cada línea (congelado al vender, o reconstruido con el historial de compras) es
 * IDÉNTICO en las dos cuentas y la diferencia entre ambos márgenes es, centavo a centavo, el descuento que salió del margen. Dos
 * pasadas por cliente (no una global) porque lo que importa acá es la fila POR CLIENTE, no un total de la sucursal.
 */

export interface FilaDescuentoCliente {
  clienteId: string;
  cliente: string;
  /** Líneas VENTA netas de este cliente en el rango (una por `Operacion` — ver el docstring del módulo). */
  cantidadVentas: number;
  unidadesVendidas: number;
  ingresoALista: number;
  ingresoCobrado: number;
  /** `ingresoALista - ingresoCobrado`, exacto (aritmética de precios, no depende de ningún costo). */
  totalDescontado: number;
  /** `totalDescontado / ingresoALista`, en % — `null` sin ingreso de lista (no debería pasar con `cantidadVentas > 0`). */
  descuentoEfectivoPct: number | null;
  /** Margen Real sobre lo COBRADO (lo que de verdad entró) — `null` si ninguna venta de este cliente se pudo costear. */
  margenReal: number | null;
  margenRealPct: number | null;
  /** Margen Real que hubiera dado la MISMA venta sin el descuento (a precio de lista, mismo costo real) — para ver si el
   *  descuento dejó al cliente con un margen sano o directamente sin margen. */
  margenRealALista: number | null;
  margenRealAListaPct: number | null;
  /** Alguna parte de `margenReal`/`margenRealALista` se reconstruyó con el historial de compras (no se guardó al vender). */
  margenRealReconstruido: boolean;
  /** `false` si alguna venta de este cliente quedó afuera del margen Real — el número no cubre el 100% de lo vendido. */
  margenRealCompleto: boolean;
}

export interface ReporteDescuentosClientes {
  desde: Date;
  hasta: Date;
  ingresoALista: number;
  ingresoCobrado: number;
  totalDescontado: number;
  descuentoEfectivoPct: number | null;
  clientes: FilaDescuentoCliente[];
  aviso: string;
}