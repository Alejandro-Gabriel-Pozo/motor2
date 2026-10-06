/**
 * Fachada PÚBLICA y PURA del dominio `reportes` (Task #41, Fase C3).
 *
 * Fuera de `core/reportes/` se importa esta fachada o `public-servidor.ts`, nunca un archivo interno (regla
 * `sin-internals-de-otro-dominio` de `.dependency-cruiser.cjs`). Acá van SOLO los módulos que no alcanzan `@/lib/db` ni el
 * runtime de Prisma, ni directa ni transitivamente (regla `publico-puro`). Lo que sí toca la base va en
 * `public-servidor.ts`.
 *
 * Solo TIPOS (se borran al compilar): la función `compararRendimientosPorSucursal` hace consultas y va en `public-servidor.ts` (Pureza Fase 2, paso 2.2).
 *
 * Solo reexports explícitos (nunca `export *`, nunca lógica), y solo lo que hoy se usa desde afuera del dominio.
 */
export type { FiltroComparacionRendimiento, FilaComparacionRendimiento } from "./rendimiento-por-sucursal";
export { FOOD_COST_OBJETIVO_PCT } from "./margen-objetivo";
export { resolverObjetivoFoodCost } from "./margen-objetivo";
export { resolverRangoDeReporte } from "./rango-por-defecto";
export type { FilaDebidoConsignante } from "./consignacion";
export type { FilaStockSinVenderConsignacion } from "./consignacion";
export type { FilaResumenConsolidado } from "./resumen-consolidado";
export type { FilaCostoProducto } from "./costos";
export type { FilaImpactoInsumo } from "./costos";
export { resolverAccionFaltante } from "./accion-faltante";
export type { FilaDescuentoCliente } from "./descuentos-clientes";
export type { FilaDescuentoProducto } from "./descuentos-productos";
export { diasAtrasDeUrl } from "./dias-atras";
export type { FilaDevolucionProducto } from "./devoluciones";
export type { FilaDiferenciaAjuste } from "./diferencias-ajustes";
export type { IngredienteRecetaVigente } from "./historial-producto";
export type { FilaCompraHistorial } from "./historial-vistas";
export type { ResumenCompras } from "./historial-vistas";
export type { FilaVentaPorDia } from "./historial-vistas";
export type { EventoHistorialProducto } from "./historial-producto";
export type { QueMostrar } from "./historial-vistas";
export type { RangoHistorial } from "./historial-vistas";
export { agruparVentasPorDia } from "./historial-vistas";
export { filtrarEventosKardex } from "./historial-vistas";
export { quitarDineroDeEventos } from "./historial-vistas";
export { resolverRangoHistorial } from "./historial-vistas";
export { resumirCompras } from "./historial-vistas";
export type { FilaInsumoSinReceta } from "./insumos-sin-receta";
export type { FilaMargenPromocion } from "./margen-promociones";
export type { FilaPerdida } from "./perdidas";
export type { ComparativaPreciosDelPeriodo } from "./periodo";
export type { FilaAlertaDigest } from "./periodo";
export type { FilaGastoPorGrupo } from "./periodo";
export { SIN_PROVEEDOR } from "./compras-filtros";
export type { FilaMargenProducto } from "./periodo";
export type { FilaCompraPorProveedor } from "./periodo";
export type { FilaGastoPorInsumo } from "./periodo";
export type { FilaPrecioInsumo } from "./periodo";
export type { FilaImpactoRecetaPorPeriodo } from "./costos";
export { ETIQUETA_ROTULO } from "./rendimiento-recetas-vistas";
export { desvioEsNotable } from "./rendimiento-recetas-vistas";
export type { RotuloLinea } from "./rendimiento-recetas-vistas";
export type { MetodoRendimiento } from "./rendimiento-conciliado";
export { explicarConfianza } from "./rendimiento-recetas-vistas";
export type { Confianza } from "./rendimiento-recetas-vistas";
export type { FilaSaludProducto } from "./salud-por-producto";
export type { FilaVentaSinReceta } from "./ventas-sin-receta";
export type { OperacionEncontrada } from "./trazabilidad";
export type { ItemOperacion } from "./trazabilidad";
export type { FilaValuacionInventario } from "./valuacion";
export type { obtenerReporteVencimientosDatos } from "./vencimientos";
export { resolverRangoPorDefecto } from "./rango-por-defecto";
export type { UltimaCotizacion } from "./cotizacion-dolar";
export type { OpcionRango } from "./rango-por-defecto";
