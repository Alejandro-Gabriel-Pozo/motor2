import "server-only";
import type { FaltaFiltrable } from "@/core/catalogo/public";
import { faltasQueSePuedenFiltrar, puedeBuscarPorReferenciaDelProveedor, type ContextoDeLosFiltros } from "@/server/lecturas/catalogo/filtros-de-productos";

/**
 * Qué «le falta algo» puede pedir quien mira la lista de Productos (Fase 6, bloque 3, 3b). La página lo pide acá (las páginas leen por `server/consultas`); el cálculo es el de la lectura compartida, el
 * mismo que usa la Server Action al filtrar: así lo que la pantalla ofrece y lo que el servidor aplica no pueden distinguirse.
 */
export async function faltasQueSePuedenFiltrarEnLaLista(ctx: ContextoDeLosFiltros): Promise<readonly FaltaFiltrable[]> {
  return faltasQueSePuedenFiltrar(ctx);
}

/** Fase 7, M2: si la búsqueda de la lista también encuentra por cómo lo llama un proveedor (el mismo cálculo que aplica el servidor al buscar): la página lo dice en la etiqueta del campo. */
export async function buscaPorReferenciaDelProveedorEnLaLista(ctx: ContextoDeLosFiltros): Promise<boolean> {
  return puedeBuscarPorReferenciaDelProveedor(ctx);
}
