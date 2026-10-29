/**
 * «Ventas por opción» (ventas con opciones, 2026-10-29): de las ventas vigentes del período, cuánto se vendió de cada OPCIÓN elegida dentro del precio (MEDIDA, VARIANTE, INCLUIDA y la «ninguna»
 * elegida): «¿qué se vendió de Coca, de Fanta, de Wok de pollo?». Una fila es (producto, grupo, opción). Puro: recibe lo que la consulta agregó en SQL (`consultas/reportes/ventas-por-opcion.ts`) y arma
 * la fila con su margen. Dinero siempre en centavos enteros.
 *
 * Qué significan las cifras (lo dice la pantalla): dentro de un grupo de elección única las filas suman el total del producto; entre grupos distintos NO se suman (la misma venta aparece en «Grande»
 * y en «Pollo»). Los adicionales no van (ya aparecen como su producto ancla). El costo es solo el que se congeló al vender: si a alguna venta de la fila no se le guardó, no hay margen y se dice
 * cuántas faltan; no se reconstruye ni se inventa.
 */

/** Lo que la consulta agrega por (producto, grupo, opción): cantidades y centavos ya sumados; nombres de la venta más reciente. */
export interface VentaPorOpcionCruda {
  productoId: string;
  producto: string;
  grupoId: string;
  grupo: string;
  opcionId: string;
  opcion: string;
  /** Unidades vendidas (la magnitud de las filas VENTA). */
  unidades: number;
  /** Lo cobrado, en centavos enteros (la suma del precio total de las filas VENTA). */
  importeCentavos: number;
  /** El costo congelado al vender, en centavos enteros, solo de las filas VENTA que lo guardaron. */
  costoCentavos: number;
  /** Cuántas filas VENTA tiene la fila del reporte, y cuántas de ellas no guardaron su costo. */
  ventas: number;
  ventasSinCosto: number;
}

export interface FilaVentaPorOpcion {
  productoId: string;
  producto: string;
  grupoId: string;
  grupo: string;
  opcionId: string;
  opcion: string;
  unidades: number;
  importeCentavos: number;
  /** `null` si alguna venta de la fila no guardó su costo (no se reconstruye). */
  costoCentavos: number | null;
  /** Importe menos costo, en centavos; `null` si falta el costo. */
  margenCentavos: number | null;
  /** Margen sobre el importe, con un decimal; `null` si falta el costo o el importe es 0. */
  margenPorcentaje: number | null;
  /** Solo cuando falta el costo: cuántas ventas de la fila no lo guardaron y de cuántas. */
  costoIncompleto: { sinCosto: number; de: number } | null;
}

const COLLATOR = new Intl.Collator("es", { sensitivity: "base" });

export function armarVentasPorOpcion(crudas: readonly VentaPorOpcionCruda[]): FilaVentaPorOpcion[] {
  return crudas
    .map((c): FilaVentaPorOpcion => {
      const completo = c.ventasSinCosto === 0;
      const margenCentavos = completo ? c.importeCentavos - c.costoCentavos : null;
      return {
        productoId: c.productoId,
        producto: c.producto,
        grupoId: c.grupoId,
        grupo: c.grupo,
        opcionId: c.opcionId,
        opcion: c.opcion,
        unidades: c.unidades,
        importeCentavos: c.importeCentavos,
        costoCentavos: completo ? c.costoCentavos : null,
        margenCentavos,
        margenPorcentaje: margenCentavos !== null && c.importeCentavos > 0 ? Math.round((margenCentavos * 1000) / c.importeCentavos) / 10 : null,
        costoIncompleto: completo ? null : { sinCosto: c.ventasSinCosto, de: c.ventas },
      };
    })
    .sort((a, b) => COLLATOR.compare(a.producto, b.producto) || COLLATOR.compare(a.grupo, b.grupo) || b.unidades - a.unidades || COLLATOR.compare(a.opcion, b.opcion) || (a.opcionId < b.opcionId ? -1 : 1));
}
