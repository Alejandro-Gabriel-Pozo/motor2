import { prisma } from "@/lib/db";
import { construirIndiceRecetas, construirMapaProductos, redondearCantidad, type Db } from "./comun";

export type EstadoDiferencia = "REVISAR" | "ESPERADO" | "OK";

export interface RecetaQueUsaInsumo {
  productoVentaId: string;
  productoVentaNombre: string;
  mermaPorcentajeActual: number;
}

export interface FilaDiferenciaAjuste {
  productoId: string;
  producto: string;
  codigo: string;
  grupo: "a" | "b";
  grupoTexto: string;
  sumaAjustesManuales: number;
  ultimaFechaAjuste: Date | null;
  ultimaCantidadAjuste: number;
  sumaConteosFisicos: number;
  ultimaFechaConteo: Date | null;
  ultimaCantidadConteo: number;
  estado: EstadoDiferencia;
  /**
   * Solo grupo "b" (Solo receta): en qué recetas aparece este insumo, con
   * la merma % vigente en cada una — para poder linkear directo a
   * corregirla, en vez de dejar "ESPERADO" sin ningún siguiente paso.
   */
  recetasQueLoUsan: RecetaQueUsaInsumo[];
  /**
   * Señal direccional (nunca un número puntual — atribuir la magnitud
   * exacta a una receta en particular exigiría prorratear el consumo
   * entre todas las recetas que usan este insumo, cada una con su propia
   * merma%, y arriesgarse a un cálculo tan engañoso como el que ya se
   * descartó para "Rendimiento real de recetas" opción B): si el neto de
   * Ajustes+Conteos es negativo, la merma real fue MAYOR a la cargada
   * (conviene subir el %); si es positivo, fue MENOR (conviene bajarlo).
   */
  sugerenciaMerma: "aumentar" | "disminuir" | null;
}

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
 */
export async function generarReporteDiferenciasAjustes(sucursalId: string, db: Db = prisma): Promise<FilaDiferenciaAjuste[]> {
  const productos = await construirMapaProductos(sucursalId, db);
  const { recetaPorProducto, mpsEnRecetas } = await construirIndiceRecetas(db);

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
    where: { seccion: { sucursalId }, proceso: { in: ["AJUSTE", "CONTROL"] } },
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
    });
  }

  return filas.sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || a.producto.localeCompare(b.producto));
}
