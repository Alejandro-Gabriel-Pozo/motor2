/**
 * La regla de prioridad del mínimo, en UN solo lugar (la usan `resolverStockMinimo` y `calcularAlertasStock`): gana el de la sección si
 * existe, si no el global de la sucursal, si no `null` ("sin mínimo cargado"). Un 0 es un mínimo real y gana sobre el global: por eso es `??`
 * y no `||`.
 */
export function elegirMinimo(porSeccion: number | null | undefined, global: number | null | undefined): number | null {
  return porSeccion ?? global ?? null;
}
