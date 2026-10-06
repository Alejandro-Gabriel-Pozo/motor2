/*
 * FACHADA del reporte por período. Los cálculos viven en `periodo-*.ts` (tipos, ventas, compras, ratio, precios, margen, alertas,
 * categorías); acá quedan solo las funciones que arman el reporte completo y las reexportaciones CON NOMBRE de todo lo que este archivo
 * exportaba antes de dividirlo, para que ningún importador cambie. Regla: ningún `periodo-*.ts` importa `./periodo` (sería un ciclo);
 * si uno necesita algo de otro, lo importa directo de ese archivo.
 */
export type { FilaAlertaDigest } from "./periodo-alertas";
export type { FilaCompraPorProveedor, FilaGastoPorGrupo, FilaGastoPorInsumo } from "./periodo-compras";
export type { ComparativaPreciosDelPeriodo, FilaPrecioInsumo } from "./periodo-precios";
export type { FilaMargenProducto } from "./periodo-margen";
export type { FilaCategoriaVenta } from "./periodo-categorias";
export { agruparVentasPorCategoria, pvSinCategoriaDe } from "./periodo-categorias";