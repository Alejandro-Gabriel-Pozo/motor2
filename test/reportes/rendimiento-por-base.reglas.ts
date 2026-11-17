/**
 * ORÁCULO ESCRITO A MANO, aparte del código (M3d: docs/diseno-merma-m3d-rendimiento-y-calibracion-2026-11-17.md, nivel 10): lo que el reporte de rendimiento tiene que mostrar para la
 * MISMA comida cargada en neto o en bruto. Merma 10 %, estimado bruto observado 0,5 (10 comprados / 20 vendidos). Los números salen de hacer la cuenta a mano, no de llamar a las funciones.
 *
 *   NETA , cantidad 0,4  → bruto teórico = 0,4 × 1,10 = 0,44 ; estimado que se escribe = 0,5 ÷ 1,10 = 0,4545… → 0,455 (3 decimales del reporte) ; desvío = (0,5 − 0,44) ÷ 0,44 = 13,6 %
 *   BRUTA, cantidad 0,44 → bruto teórico = 0,44 (la cantidad ya es el bruto) ; estimado que se escribe = 0,5 (bruto tal cual) ; desvío = 13,6 % (IDÉNTICO)
 */
export interface CasoDeRendimientoPorBase {
  base: "NETA" | "BRUTA";
  cantidadCargada: number;
  mermaPorcentaje: number;
  estimadoBrutoObservado: number;
  teoricoBruto: number;
  estimadoEnLaBase: number;
  desviacionPorcentaje: number;
}

export const CASOS_DE_RENDIMIENTO_POR_BASE: readonly CasoDeRendimientoPorBase[] = [
  { base: "NETA", cantidadCargada: 0.4, mermaPorcentaje: 10, estimadoBrutoObservado: 0.5, teoricoBruto: 0.44, estimadoEnLaBase: 0.455, desviacionPorcentaje: 13.6 },
  { base: "BRUTA", cantidadCargada: 0.44, mermaPorcentaje: 10, estimadoBrutoObservado: 0.5, teoricoBruto: 0.44, estimadoEnLaBase: 0.5, desviacionPorcentaje: 13.6 },
  // Sin merma las dos bases coinciden en todo.
  { base: "NETA", cantidadCargada: 0.4, mermaPorcentaje: 0, estimadoBrutoObservado: 0.5, teoricoBruto: 0.4, estimadoEnLaBase: 0.5, desviacionPorcentaje: 25 },
  { base: "BRUTA", cantidadCargada: 0.4, mermaPorcentaje: 0, estimadoBrutoObservado: 0.5, teoricoBruto: 0.4, estimadoEnLaBase: 0.5, desviacionPorcentaje: 25 },
];
