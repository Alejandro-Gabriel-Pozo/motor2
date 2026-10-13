/**
 * Aplicabilidad de un PLAN DE COSTOS EN UNA SUCURSAL (M7, ADR-031; familia «optin» de ADR-009).
 *
 * FILA AUSENTE = NO APLICA. Un plan de costos (por ejemplo «unidades de negocio») solo rige en las sucursales donde el administrador lo
 * activó a propósito: sin fila de `PlanDeCostosSucursal`, o con `aplica: false`, el plan NO aplica ahí y los gastos de esa sucursal
 * quedan «no aplica» (no «sin asignar»: no hay nada pendiente de distribuir). Las dos situaciones significan lo mismo para el sistema;
 * esta función es el ÚNICO lugar que colapsa esa equivalencia, para que no haya un segundo criterio escrito a mano en otra pantalla
 * o en otro caso de uso.
 *
 * Es pura (sin Prisma ni base) para poder probarla sin base. Por ahora no la llama ningún código de producción: el caso de uso de
 * distribuir un gasto (Etapa C) y el reporte por unidad de negocio la usan cuando existan.
 */

interface FilaDeAplicabilidadDePlan {
  aplica: boolean;
}

/** Fila ausente (undefined/null) = el plan NO aplica en la sucursal. `aplica: false` es lo mismo para el sistema; solo `true` aplica. */
export function planDeCostosAplica(fila: FilaDeAplicabilidadDePlan | null | undefined): boolean {
  return fila?.aplica === true;
}
