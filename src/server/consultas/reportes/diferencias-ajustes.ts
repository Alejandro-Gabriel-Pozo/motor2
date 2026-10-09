import "server-only";
import { OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION } from "@/core/movimientos/public";
import { construirIndiceRecetas, construirMapaProductos } from "@/server/lecturas/reportes/comun";
import type { Db } from "@/lib/db-tipos";
import { redondearCantidad } from "@/core/reportes/public";
import { resolverProximoConteo } from "@/core/stock/public";
import type { EstadoDiferencia, RecetaQueUsaInsumo, FilaDiferenciaAjuste, InfoProductoReporte } from "@/core/reportes/public";

const ORDEN_ESTADO: Record<EstadoDiferencia, number> = { REVISAR: 0, ESPERADO: 1, OK: 2 };

/**
 * Port de generarReporteDiferenciasAjustes_ (Reportes.js:724-805). No todas
 * las diferencias de stock significan lo mismo:
 * - MP sin ninguna receta que la consuma: su saldo es una suma literal de
 *   movimientos reales — un Ajuste ahí es una anomalía a investigar.
 * - MP que solo se descuenta vía Receta: el consumo es una fórmula, no una
 *   medición real — un Ajuste ahí es esperable (señal para recalibrar la
 *   Merma % de la receta).
 *
 * A diferencia de Apps Script (que sumaba AJUSTE y CONTROL juntos hasta el
 * bugfix documentado ahí), acá siempre estuvieron separados —
 * MovimientoStock.proceso distingue 'AJUSTE' de 'CONTROL' desde el día uno.
 *
 * `hoy` (D.3a de docs/pureza-integracion.md) es obligatorio, sin valor por defecto: el vencimiento de la agenda de conteo se mide contra la hora que fija el
 * borde (la página, o Salud por producto que la recibe de la suya).
 */
export async function generarReporteDiferenciasAjustes(
  sucursalId: string,
  db: Db,
  hoy: Date,
  /** El mapa de productos de LA MISMA sucursal ya armado (`construirMapaProductos(sucursalId, db)`), para no volver a leerlo: Salud por producto lo comparte (O.39). */
  productosCargados?: Map<string, InfoProductoReporte>
): Promise<FilaDiferenciaAjuste[]> {
  const productos = productosCargados ?? (await construirMapaProductos(sucursalId, db));
  const { recetaPorProducto, mpsEnRecetas } = await construirIndiceRecetas(db, sucursalId);
  const frecuencias = await db.frecuenciaConteoProducto.findMany({ where: { sucursalId }, select: { productoId: true, frecuenciaDias: true } });
  const frecuenciaPorProducto = new Map(frecuencias.map((f) => [f.productoId, f.frecuenciaDias]));

  // Índice inverso: por cada insumo (MP), en qué recetas (PV) aparece y con
  // qué merma % vigente — para poder linkear directo a corregirla.
  const recetasPorInsumo = new Map<string, RecetaQueUsaInsumo[]>();
  for (const [productoVentaId, ingredientes] of recetaPorProducto) {
    const productoVenta = productos.get(productoVentaId);
    if (!productoVenta) continue;
    for (const ing of ingredientes) {
      const lista = recetasPorInsumo.get(ing.insumoProductoId) ?? [];
      lista.push({ productoVentaId, productoVentaNombre: productoVenta.nombre, mermaPorcentajeActual: ing.mermaPorcentaje });
      recetasPorInsumo.set(ing.insumoProductoId, lista);
    }
  }

  const movimientos = await db.movimientoStock.findMany({
    // Sin las Operaciones AJUSTE que escribe una anulación (de una venta o de una compra): son el propio deshacer, no un ajuste manual de stock.
    where: { seccion: { sucursalId }, proceso: { in: ["AJUSTE", "CONTROL"] }, operacion: OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION },
    select: { productoId: true, proceso: true, cantidad: true, operacion: { select: { fecha: true } } },
  });

  interface Acc {
    suma: number;
    ultimaFecha: Date | null;
    ultimaCantidad: number;
  }
  const vacio = (): Acc => ({ suma: 0, ultimaFecha: null, ultimaCantidad: 0 });
  const porProducto = new Map<string, { ajuste: Acc; conteo: Acc }>();

  for (const m of movimientos) {
    if (!porProducto.has(m.productoId)) porProducto.set(m.productoId, { ajuste: vacio(), conteo: vacio() });
    const acc = porProducto.get(m.productoId)![m.proceso === "CONTROL" ? "conteo" : "ajuste"];
    const cantidad = Number(m.cantidad);
    acc.suma += cantidad;
    if (!acc.ultimaFecha || m.operacion.fecha > acc.ultimaFecha) {
      acc.ultimaFecha = m.operacion.fecha;
      acc.ultimaCantidad = cantidad;
    }
  }

  const vacia: Acc = { suma: 0, ultimaFecha: null, ultimaCantidad: 0 };
  const filas: FilaDiferenciaAjuste[] = [];

  for (const info of productos.values()) {
    if (info.tipo !== "MP") continue;

    const enReceta = mpsEnRecetas.has(info.id);
    const grupo: "a" | "b" = !enReceta ? "a" : "b";

    const datos = porProducto.get(info.id);
    const ajuste = datos?.ajuste ?? vacia;
    const conteo = datos?.conteo ?? vacia;
    const huboDiferencia = ajuste.suma !== 0 || conteo.suma !== 0;
    const estado: EstadoDiferencia = grupo === "a" ? (huboDiferencia ? "REVISAR" : "OK") : "ESPERADO";

    const netoAjustesYConteos = ajuste.suma + conteo.suma;
    const sugerenciaMerma: FilaDiferenciaAjuste["sugerenciaMerma"] =
      grupo === "b" && netoAjustesYConteos !== 0 ? (netoAjustesYConteos < 0 ? "aumentar" : "disminuir") : null;

    const { proximaFecha, vencido } = resolverProximoConteo({ ultimaFechaConteo: conteo.ultimaFecha, frecuenciaDias: frecuenciaPorProducto.get(info.id) ?? 0, hoy });

    filas.push({
      productoId: info.id,
      producto: info.nombre,
      codigo: info.codigo,
      grupo,
      grupoTexto: grupo === "a" ? "Sin receta asociada" : "Solo receta",
      sumaAjustesManuales: redondearCantidad(ajuste.suma),
      ultimaFechaAjuste: ajuste.ultimaFecha,
      ultimaCantidadAjuste: redondearCantidad(ajuste.ultimaCantidad),
      sumaConteosFisicos: redondearCantidad(conteo.suma),
      ultimaFechaConteo: conteo.ultimaFecha,
      ultimaCantidadConteo: redondearCantidad(conteo.ultimaCantidad),
      estado,
      recetasQueLoUsan: grupo === "b" ? (recetasPorInsumo.get(info.id) ?? []) : [],
      sugerenciaMerma,
      proximaFechaConteo: proximaFecha,
      conteoVencido: vencido,
    });
  }

  return filas.sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || a.producto.localeCompare(b.producto));
}