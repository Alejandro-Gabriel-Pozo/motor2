/**
 * Fachada PÚBLICA DE SERVIDOR del dominio `reportes` (Task #41, Fase C3).
 *
 * Los módulos de `reportes` que alcanzan la base (`@/lib/db`) o el runtime de Prisma, directa o transitivamente. Separada de
 * `public.ts` a propósito: esa la importan módulos que terminan en el bundle del cliente, y esta no puede llegar ahí.
 *
 * Sin `import "server-only"`: Vitest, Playwright (specs que importan `core/`) y los scripts standalone (`tsx`) cargan
 * `core/` fuera de la resolución de módulos de Next, donde ese paquete tira al importarse.
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio:
 * `core/carta/reporte-secciones.ts` (comun + periodo) y `core/movimientos/registrar-venta.ts` (costos — el único ciclo
 * real entre dominios de `core`, ya exceptuado en `dependencias.test.ts`).
 */
export { redondearCantidad } from "./comun";
export type { Db } from "./comun";
export {
  agruparVentasPorCategoria,
  obtenerReportePorPeriodoConCatalogo,
  pvSinCategoriaDe,
  generarReporteVentasPorCategoria,
} from "./periodo";
export type { FilaCategoriaVenta } from "./periodo";
export { calcularCostosYMargenes } from "./costos";
export { compararRendimientosPorSucursal } from "./rendimiento-por-sucursal";
export { cargarObjetivosDeMargen } from "./margen-objetivo-consulta";
export { listarComprasRegistradas } from "./compras-registradas";
export { SIN_PROVEEDOR } from "./compras-registradas";
export { generarReporteConsignacion } from "./consignacion";
export { obtenerResumenConsolidado } from "./resumen-consolidado";
export { calcularImpactoInsumos } from "./costos";
export { obtenerReporteDescuentosClientes } from "./descuentos-clientes";
export { obtenerReporteDescuentosProductos } from "./descuentos-productos";
export { generarReporteDevoluciones } from "./devoluciones";
export { generarReporteDiferenciasAjustes } from "./diferencias-ajustes";
export { obtenerHistorialProducto } from "./historial-producto";
export { obtenerIngredientesRecetaVigente } from "./historial-producto";
export { generarReporteHuecosCatalogo } from "./huecos-catalogo";
export { obtenerProblemasUnidadMezclada } from "./huecos-catalogo";
export { generarReporteInsumosSinRecetaVinculada } from "./insumos-sin-receta";
export { obtenerReporteMargenPromociones } from "./margen-promociones";
export { obtenerResumenOperativo } from "./resumen-operativo";
export { obtenerUltimaCotizacionSinRomper } from "./cotizacion-dolar";
export { generarReportePerdidas } from "./perdidas";
export { obtenerReportePorPeriodo } from "./periodo";
export { calcularRendimientoRecetasSimples } from "./rendimiento-recetas";
export { calcularRendimientoRecetasCompartidas } from "./rendimiento-recetas";
export { generarReporteRotacionMesas } from "./rotacion-mesas";
export { generarReporteVentasSinReceta } from "./ventas-sin-receta";
export { listarTicketsEmitidos } from "./tickets-emitidos";
export { leerFiltroTickets } from "./tickets-emitidos";
export { obtenerNumeroDeMesa } from "./tickets-emitidos";
export { serializarFiltroTickets } from "./tickets-emitidos";
export { buscarOperacionesPorProducto } from "./trazabilidad";
export { obtenerOperacionPorId } from "./trazabilidad";
export { calcularValuacionInventario } from "./valuacion";
export { obtenerReporteVencimientosDatos } from "./vencimientos";
export { sincronizarDolar } from "./cotizacion-dolar";
export { sincronizarIPC } from "./indices-economicos";
export { actualizarDolarSiHaceFalta } from "./cotizacion-dolar";
export { cotizacionVencida } from "./cotizacion-dolar";
export { pesosADolares } from "./cotizacion-dolar";
