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
  /**
   * Agenda de conteo periódico (sub-plan S, docs/plan-rendimiento-recetas-
   * 2026-09-22.md §E — decisión 2 de §3). `null` sin agenda
   * (`FrecuenciaConteoProducto` ausente o `frecuenciaDias` 0) o sin ningún
   * conteo previo (no hay ancla desde la cual calcular — ver
   * `resolverProximoConteo`).
   */
  proximaFechaConteo: Date | null;
  /** Agenda activa y sin ningún conteo cumplido todavía, o `hoy` ya pasó `proximaFechaConteo`. */
  conteoVencido: boolean;
}