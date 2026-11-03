import type { GrupoParaVender } from "./linea-configurada";

/**
 * Cuántos insumos distintos PUEDE sumar alguna de las opciones que un producto ofrece (ventas con opciones, 2026-10-29): la definición de «origen de stock» del CATÁLOGO para un producto sin receta,
 * donde no hay una línea con opciones elegidas sino lo que el producto admite. Cuenta las SUMA de las opciones del precio (MEDIDA, VARIANTE, INCLUIDA) ofrecidas: el grupo y la opción activos y
 * admitidos por el producto, sin contar el apagado temporal de la sucursal (volver a prenderla no pide tocar el catálogo). Un REEMPLAZA no cuenta (con la base vacía no tiene qué reemplazar), la
 * opción «ninguna» aporta cero y los ADICIONALES no entran (se venden como su producto ancla, no cambian el consumo de la base). Puro.
 */
export function insumosQuePuedeSumarAlgunaOpcion(grupos: readonly GrupoParaVender[]): number {
  const insumos = new Set<string>();
  for (const g of grupos) {
    if (!g.activo || !g.admitido || g.tipo === "ADICIONAL") continue;
    for (const o of g.opciones) {
      if (!o.activa || !o.admitida || o.esNinguna) continue;
      for (const c of o.consumos) if (c.efecto === "SUMA") insumos.add(c.insumoProductoId);
    }
  }
  return insumos.size;
}
