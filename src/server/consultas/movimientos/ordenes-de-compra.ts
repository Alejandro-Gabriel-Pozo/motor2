import "server-only";

/**
 * Compras, orden de compra (etapa OC): lo que piden las PÁGINAS de órdenes y el selector de «Cargar compra» (las páginas leen por `server/consultas`, regla `paginas-solo-consultas`). Las lecturas y sus formas viven en
 * `server/lecturas/movimientos/ordenes-de-compra.ts` porque las comparten con la Server Action del selector y con los casos de uso (ADR-026); acá solo se reexponen.
 */
export { cargarNivelDelControlDeExceso, listarOrdenesParaMostrar, listarProveedoresParaOrden } from "@/server/lecturas/movimientos/ordenes-de-compra";
export type { OrdenParaMostrar } from "@/server/lecturas/movimientos/ordenes-de-compra";
