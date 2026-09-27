import type { FilaImpactoRecetaPorPeriodo } from "./costos";
import type { RatioGastoVentas } from "./periodo-ratio";
import type { GastoPorInsumoDelPeriodo } from "./periodo-compras";
import type { FilaPrecioInsumo } from "./periodo-precios";

export interface FilaAlertaDigest {
  texto: string;
  severidad: "alta" | "media";
}

/**
 * Resumen de hasta 5 alertas fijas, siempre visibles arriba del reporte —
 * paso 3 del grounding (segunda pasada, docs/grounding-reportes-compras-
 * 2026-09-18.md §5): "un dueño de pizzería chica no configura umbrales ni
 * lee mails de su ERP" — nada de esto es configurable ni es una
 * notificación aparte, es pura síntesis de lo que las funciones de arriba
 * YA calcularon (no dispara ninguna consulta nueva). Orden fijo por
 * prioridad: primero lo que pone en duda los datos (sospechoso), después
 * lo que más plata movió, después a qué plato le pegó más, después la
 * tendencia general, y por último contexto de concentración — se recorta
 * a 5 aunque hubiera más candidatos.
 */
export function generarDigestAlertas(
  ratioGastoVentas: RatioGastoVentas,
  gastoPorInsumo: GastoPorInsumoDelPeriodo,
  tendenciaPrecios: FilaPrecioInsumo[],
  impactoRecetas: FilaImpactoRecetaPorPeriodo[]
): FilaAlertaDigest[] {
  const alertas: FilaAlertaDigest[] = [];

  const sospechosos = tendenciaPrecios.filter((f) => f.sospechoso);
  if (sospechosos.length === 1) {
    const s = sospechosos[0]!;
    alertas.push({
      severidad: "alta",
      texto: `Revisá la carga de "${s.insumo}": el precio cambió ${s.deltaPct! > 0 ? "+" : ""}${s.deltaPct}% de golpe — más probable un error de carga (unidad/presentación) que una suba real.`,
    });
  } else if (sospechosos.length > 1) {
    alertas.push({
      severidad: "alta",
      texto: `Revisá la carga de ${sospechosos.length} insumos con cambios de precio poco creíbles (más de 200%) — más probable un error de carga que subas reales.`,
    });
  }

  const conImpacto = tendenciaPrecios.filter((f) => f.deltaImpacto !== null && f.deltaImpacto !== 0);
  if (conImpacto.length > 0) {
    const top = conImpacto[0]!; // ya viene ordenado por |impacto| desde calcularTendenciaPreciosDelPeriodo
    const sube = top.deltaImpacto! > 0;
    alertas.push({
      severidad: sube ? "alta" : "media",
      texto: `"${top.insumo}" es lo que más ${sube ? "te encareció" : "te abarató"} las compras: ${sube ? "+" : ""}$${top.deltaImpacto!.toLocaleString("es-AR")} (${top.deltaPct! > 0 ? "+" : ""}${top.deltaPct}%) sobre lo que compraste este período.`,
    });
  }

  if (impactoRecetas.length > 0) {
    const plato = impactoRecetas[0]!; // ya viene ordenado por |deltaCosto| desde calcularImpactoRecetasPorPeriodo — puede ser el que más subió O el que más bajó
    const pctTexto = plato.foodCostPctAntes !== null && plato.foodCostPctActual !== null ? ` (food cost ${plato.foodCostPctAntes}% → ${plato.foodCostPctActual}%)` : "";
    const empeoro = plato.deltaCosto > 0; // costo subió = le pegó de verdad; costo bajó = mejoró el margen, no es algo "golpeado"
    alertas.push({
      severidad: empeoro ? "alta" : "media",
      texto: `El plato que más se ${empeoro ? "encareció" : "abarató"} por estos cambios es "${plato.productoNombre}": costo ${empeoro ? "+" : ""}$${plato.deltaCosto.toLocaleString("es-AR")}${pctTexto}.`,
    });
  }

  if (ratioGastoVentas.porcentaje !== null && ratioGastoVentas.porcentajePeriodoAnterior !== null) {
    const diferencia = Math.round((ratioGastoVentas.porcentaje - ratioGastoVentas.porcentajePeriodoAnterior) * 10) / 10;
    if (Math.abs(diferencia) >= 3) {
      alertas.push({
        severidad: diferencia > 0 ? "alta" : "media",
        texto: `Compras/Ventas ${diferencia > 0 ? "subió" : "bajó"} de ${ratioGastoVentas.porcentajePeriodoAnterior}% a ${ratioGastoVentas.porcentaje}% respecto al período anterior.`,
      });
    }
  }

  if (alertas.length < 5 && gastoPorInsumo.porInsumo.length >= 3) {
    const corte80 = gastoPorInsumo.porInsumo.findIndex((f) => f.porcentajeAcumulado >= 80);
    if (corte80 >= 0 && corte80 + 1 < gastoPorInsumo.porInsumo.length) {
      alertas.push({
        severidad: "media",
        texto: `${corte80 + 1} de ${gastoPorInsumo.porInsumo.length} insumos concentran el 80% de lo que gastaste en Compras este período.`,
      });
    }
  }

  return alertas.slice(0, 5);
}
