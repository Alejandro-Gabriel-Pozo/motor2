import type { ClasificacionNoComestibles } from "@/core/catalogo/public";
import {
  asegurarIndiceRecetasDeLaSucursal,
  calcularCostosYMargenesDesde,
  calcularImpactoInsumosDesde,
  calcularImpactoRecetasPorPeriodoDesde,
  type CostoMP,
  type FilaCostoProducto,
  type FilaImpactoInsumo,
  type FilaImpactoRecetaPorPeriodo,
  type IndiceRecetas,
  type InfoProductoReporte,
  type ObjetivosDeMargen,
} from "@/core/reportes/public";
import type { Db } from "@/lib/db-tipos";
import { cargarClasificacionNoComestibles, construirIndiceRecetas, construirMapaProductos, obtenerCostoActualPorMP } from "./comun";

/**
 * Los cargadores de los reportes de costos (Pureza Fase 4, tramo A): mudados TAL CUAL desde `core/reportes/costos.ts` (mismo nombre, misma firma, mismas lecturas en el mismo
 * orden); el cálculo es puro y vive allá (`calcularCostosYMargenesDesde`, `calcularImpactoInsumosDesde`, `calcularImpactoRecetasPorPeriodoDesde`). La venta los llama DENTRO de su
 * transacción (siempre con el `tx` de quien llama). Sin `import "server-only"`: los importan scripts con `tsx`.
 */

/**
 * Port de calcularCostosYMargenes_ (Reportes.js:1710-1787). Sesión
 * "eliminar COMPRA+VENTA": lo único vendible es un PV — un producto que
 * "compra y revende tal cual" tiene una receta 1:1 hacia la MP que
 * consume, así que cae en la rama normal, sin necesitar una rama aparte.
 *
 * DECISIÓN (a propósito, no oculta): si falta el precio de algún insumo de
 * la receta, el costo de ESE plato queda `costoIncompleto` y no se inventa
 * un margen parcial — mostrar un número que parece real pero está calculado
 * sobre menos ingredientes de los que hay sería peor que no mostrar nada.
 */
export async function calcularCostosYMargenes(
  sucursalId: string,
  db: Db,
  /**
   * El catálogo ya cargado, para no volver a leerlo. TIENE que ser el de LA MISMA sucursal (`precioVenta` sale resuelto con el Precio
   * Local de esa sucursal): pasar el de otra da márgenes de otra sucursal sin ningún error. `obtenerReportePorPeriodo` lo comparte entre
   * todas sus funciones; no lo pasa quien llama desde una transacción (ver `registrarVenta`), donde un mapa traído de afuera sería de
   * otro snapshot.
   */
  productosCargados?: Map<string, InfoProductoReporte>,
  /** El índice de recetas ya cargado, mismo motivo que `productosCargados` — ver `calcularMargenDelPeriodo`/`obtenerReportePorPeriodoConCatalogo`, que lo comparten entre las funciones que lo necesitan. */
  indiceRecetas?: IndiceRecetas,
  /** Los food cost objetivo cargados (`cargarObjetivosDeMargen`). Sin ellos rige el de por defecto: así el POS (`registrarVenta`) y el margen del período, que no lo usan, no leen esa tabla. */
  objetivos?: ObjetivosDeMargen,
  /**
   * El costo de reposición de HOY de LA MISMA sucursal ya leído (`obtenerCostoActualPorMP(sucursalId, db)`, sin `antesDe`), mismo motivo que
   * `productosCargados`: el reporte del período lo usa en tres lugares (impacto de recetas, margen y alerta de margen objetivo) y lo lee una vez (O.39).
   */
  costosCargados?: Map<string, CostoMP>
): Promise<FilaCostoProducto[]> {
  if (indiceRecetas) asegurarIndiceRecetasDeLaSucursal(indiceRecetas, sucursalId);
  const productos = productosCargados ?? (await construirMapaProductos(sucursalId, db));
  const { recetaPorProducto } = indiceRecetas ?? (await construirIndiceRecetas(db, sucursalId));
  const costos = costosCargados ?? (await obtenerCostoActualPorMP(sucursalId, db));
  return calcularCostosYMargenesDesde(productos, recetaPorProducto, costos, objetivos);
}

/**
 * Las dos mitades de «Costos y márgenes» (el costo y margen de cada plato, con los objetivos; y qué insumos mueven más el costo total) con UNA sola carga
 * del catálogo, las recetas y el costo de reposición (O.39 de docs/pureza-integracion.md: antes cada mitad leía todo por su cuenta, 8 consultas ×2). Mismo
 * resultado que `calcularCostosYMargenes(…, objetivos)` y el impacto de insumos por separado: el impacto se sigue calculando sobre las filas SIN objetivos
 * (el orden de las filas depende del estado, y el estado del objetivo; ese orden fija el de los platos de cada insumo), solo que con lo ya leído.
 */
// Port de calcularImpactoInsumos_ (Reportes.js:1799-1818): `insumos` es qué insumos mueven más la aguja del costo total (si una MP aparece en muchos platos y pesa mucho, un aumento suyo pega fuerte).
export async function calcularCostosYMargenesEImpactoInsumos(
  sucursalId: string,
  db: Db,
  objetivos?: ObjetivosDeMargen
): Promise<{ productos: FilaCostoProducto[]; insumos: FilaImpactoInsumo[] }> {
  const [productos, { recetaPorProducto }, costos] = await Promise.all([construirMapaProductos(sucursalId, db), construirIndiceRecetas(db, sucursalId), obtenerCostoActualPorMP(sucursalId, db)]);
  return {
    productos: calcularCostosYMargenesDesde(productos, recetaPorProducto, costos, objetivos),
    insumos: calcularImpactoInsumosDesde(calcularCostosYMargenesDesde(productos, recetaPorProducto, costos)),
  };
}

/**
 * "¿A qué platos les pega el cambio de precio de este período, y cuánto?"
 * — paso 4 del grounding (segunda pasada, docs/grounding-reportes-
 * compras-2026-09-18.md §5): la diferencia real entre software de
 * gastronomía y un ERP genérico es vincular compra -> receta -> plato,
 * algo que ninguna de las referencias de la primera pasada (ERPNext/
 * Dolibarr/Grocy) puede sugerir porque ninguna modela recetas.
 *
 * Recalcula el costo de CADA receta dos veces — con el costo de reposición
 * de HOY (`obtenerCostoActualPorMP`, el mismo "más reciente" que ya usa
 * `calcularCostosYMargenes` en todos lados) y con el que regía justo antes
 * de `desde` (mismo método, `antesDe`) — y se queda solo con los platos
 * donde el resultado cambió de verdad. Al reusar `resolverCostoUnitario`
 * (recursivo) para las dos corridas, un aumento en un intermedio "se
 * produce" (ej. la prepizza) se propaga solo, sin necesitar mapear a mano
 * qué plato usa qué intermedio.
 *
 * Un producto sin ninguna compra ANTES de `desde` (primera vez que se
 * compra) no tiene con qué comparar — `costosParaAntes` cae al costo
 * ACTUAL para ese producto puntual (no introduce una diferencia donde no
 * hay dato, mismo criterio que el delta `null` de `calcularTendenciaPreciosDelPeriodo`).
 */
export async function calcularImpactoRecetasPorPeriodo(
  sucursalId: string,
  desde: Date,
  db: Db,
  /** El catálogo ya cargado de LA MISMA sucursal, para no volver a leerlo (ver `calcularCostosYMargenes`). */
  productosCargados?: Map<string, InfoProductoReporte>,
  /** El índice de recetas ya cargado, mismo motivo (ver `obtenerReportePorPeriodoConCatalogo`). */
  indiceRecetas?: IndiceRecetas,
  /** La clasificación de grupos "No comestibles" ya cargada, mismo motivo. */
  clasificacion?: ClasificacionNoComestibles,
  /** El costo de reposición de HOY ya leído, mismo motivo (ver `costosCargados` de `calcularCostosYMargenes`). El de ANTES del período se lee acá siempre. */
  costosActualesCargados?: Map<string, CostoMP>
): Promise<FilaImpactoRecetaPorPeriodo[]> {
  if (indiceRecetas) asegurarIndiceRecetasDeLaSucursal(indiceRecetas, sucursalId);
  const productos = productosCargados ?? (await construirMapaProductos(sucursalId, db));
  const { recetaPorProducto } = indiceRecetas ?? (await construirIndiceRecetas(db, sucursalId));
  const costosActuales = costosActualesCargados ?? (await obtenerCostoActualPorMP(sucursalId, db));
  const costosAntesDelPeriodo = await obtenerCostoActualPorMP(sucursalId, db, desde);
  const hayNoComestibles = (clasificacion ?? (await cargarClasificacionNoComestibles(db))).existeGrupo;
  return calcularImpactoRecetasPorPeriodoDesde(productos, recetaPorProducto, costosActuales, costosAntesDelPeriodo, hayNoComestibles);
}
