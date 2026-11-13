import "server-only";
import type { FaltaFiltrable } from "@/core/catalogo/public";
import { lecturaDeVerificacionEnLaEmpresa } from "@/server/acceso/alcance";
import { faltasQueSePuedenFiltrar, idsQueFaltaCompletar, puedeBuscarPorReferenciaDelProveedor, type ContextoDeLosFiltros } from "@/server/lecturas/catalogo/filtros-de-productos";

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

/**
 * De los productos de una página de la lista, los que están en «Falta completar» (disponibles en alguna sucursal y con alguna falta que quien mira puede ver): la marca de su fila. Lee con la base de verificación
 * (la disponibilidad «en alguna» cruza sucursales) y solo devuelve ids de los que se le pasaron; no muestra ninguna fila ajena.
 */
export async function productosQueFaltaCompletarEnLaPagina(ctx: ContextoDeLosFiltros & { alcance?: unknown }, ids: readonly string[]): Promise<ReadonlySet<string>> {
  const verificacion = await lecturaDeVerificacionEnLaEmpresa(ctx as Parameters<typeof lecturaDeVerificacionEnLaEmpresa>[0] & ContextoDeLosFiltros);
  return idsQueFaltaCompletar(ctx, verificacion.db, ids);
}
