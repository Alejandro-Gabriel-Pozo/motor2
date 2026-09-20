import type { ComponenteCosto, EstadoCosto } from "./costos";

export interface AccionFaltante {
  href: string;
  etiqueta: string;
}

/**
 * Causa→acción para un estado de "falta un dato" — antes vivía duplicada
 * inline en `tabla-costos.tsx`; centralizada acá para que Período/Resumen
 * operativo la reusen sin reinventar el criterio (docs/comparativa-ux-
 * erpnext-dolibarr.md §7.1: esos reportes solo mostraban un booleano
 * plano "costo incompleto", sin decir qué hacer ni dónde).
 * MARGEN_NEGATIVO/FOOD_COST_ALTO/OK no son "falta un dato" sino una
 * decisión de negocio — no hay acción única a la que mandar, `null`.
 *
 * En su propio archivo (no en costos.ts) a propósito: costos.ts importa
 * `prisma` (server-only), y `tabla-costos.tsx`/`tabla-periodo.tsx` son
 * `"use client"` — importar un VALOR de costos.ts ahí arrastraría `pg` al
 * bundle del navegador (`dns`/`fs` no existen ahí, rompe el build). Este
 * archivo no importa nada server-only, así que es seguro para ambos lados.
 */
export function resolverAccionFaltante(fila: { estado: EstadoCosto; productoId: string; componentes: ComponenteCosto[] }): AccionFaltante | null {
  if (fila.estado === "SIN_RECETA") return { href: `/catalogo/recetas/${fila.productoId}`, etiqueta: "Sin receta — cargarla" };
  if (fila.estado === "SIN_PRECIO_VENTA") return { href: `/catalogo/productos/${fila.productoId}/editar`, etiqueta: "Sin precio de venta — cargarlo" };
  if (fila.estado === "COSTO_INCOMPLETO") {
    const faltantes = fila.componentes.filter((c) => c.sinPrecio);
    const primero = faltantes[0];
    if (!primero) return null;
    const etiqueta =
      faltantes.length > 1 ? `Costo incompleto — falta precio de ${faltantes.length} insumos` : `Costo incompleto — falta precio de "${primero.insumoNombre}"`;
    // Un insumo "Se produce" no se compra — su costo sale de completar SU
    // PROPIA receta, no de cargarle un precio de compra.
    const href = primero.insumoSeProduce ? `/catalogo/recetas/${primero.insumoProductoId}` : `/movimientos/compra?productoId=${primero.insumoProductoId}`;
    return { href, etiqueta };
  }
  return null;
}

/**
 * Causa→acción para el otro origen de "falta un dato" del mismo §7.1:
 * `obtenerCostoActualPorMP` (costo de reposición = última COMPRA
 * registrada) no encontró ninguna, a diferencia de `resolverAccionFaltante`
 * arriba (que es sobre el costeo de la RECETA de un PV). Pérdidas y
 * Devoluciones valorizan movimientos de insumo directo, sin pasar por una
 * receta — mismo criterio "Se produce" que el resto del archivo: no se
 * compra, se resuelve completando su propia receta.
 */
export function resolverAccionSinCostoReposicion(productoId: string, seProduce: boolean): AccionFaltante {
  return seProduce
    ? { href: `/catalogo/recetas/${productoId}`, etiqueta: "Sin costo de reposición — revisar receta" }
    : { href: `/movimientos/compra?productoId=${productoId}`, etiqueta: "Sin costo de reposición — cargar compra" };
}
