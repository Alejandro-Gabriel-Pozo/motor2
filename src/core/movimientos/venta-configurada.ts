import { Decimal } from "decimal.js";
import type { LineaArmada } from "./plan-de-la-venta";

/**
 * Dos reglas puras de la VENTA de una línea configurada (GO-2b, ADR-030). Solo las usa `armarLinea` (`registrar-venta-en-tx.ts`) para las líneas con opciones o
 * los adicionales: una línea sin opciones se arma como siempre y no pasa por acá.
 */

type Pedido = LineaArmada["pedidos"][number];

/** El clon propio de decimal.js, igual que `core/moneda.ts`: 40 dígitos y empates hacia arriba. */
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/**
 * Una fila CONSUMO por insumo: `consumoDeLineaConfigurada` puede pedir dos veces el mismo insumo (está en la base y además lo suma una opción). Se juntan en el
 * lugar del PRIMERO (que conserva sus sustitutos), sumando en decimal exacto. El libro decide después de qué sección y lote sale cada uno: un insumo que sale de
 * dos lotes sigue dejando dos filas, como hoy.
 */
export function consolidarPedidosPorInsumo(pedidos: readonly Pedido[]): Pedido[] {
  const porInsumo = new Map<string, { pedido: Pedido; cantidad: Decimal }>();
  for (const p of pedidos) {
    const previo = porInsumo.get(p.productoId);
    if (previo) previo.cantidad = previo.cantidad.plus(p.cantidad);
    else porInsumo.set(p.productoId, { pedido: p, cantidad: new D(p.cantidad) });
  }
  return [...porInsumo.values()].map(({ pedido, cantidad }) => ({ ...pedido, cantidad: cantidad.toNumber() }));
}

/**
 * El COSTO CONGELADO por unidad de una línea configurada (o de un adicional): la suma de (cantidad de cada pedido × costo unitario de su insumo), dividida por la
 * cantidad vendida, en decimal exacto (lo redondea al centavo quien escribe la fila, como siempre). Sale de SUS pedidos —la receta del producto base ya
 * transformada por las opciones, o el consumo del adicional—, nunca de la receta base sola. Si falta el costo de algún insumo, o no hay ningún pedido, `null`:
 * lo mismo que un costo incompleto.
 */
export function costoUnitarioDeLineaConfigurada(pedidos: readonly Pedido[], cantidadVendida: number, costoDeInsumo: (productoId: string) => number | null): number | null {
  if (pedidos.length === 0 || !(cantidadVendida > 0)) return null;
  let total = new D(0);
  for (const p of pedidos) {
    const costo = costoDeInsumo(p.productoId);
    if (costo === null) return null;
    total = total.plus(new D(p.cantidad).times(costo));
  }
  return total.dividedBy(cantidadVendida).toNumber();
}
