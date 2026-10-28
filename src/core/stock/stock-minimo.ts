/**
 * La regla de prioridad del mínimo, en UN solo lugar (la usan `resolverStockMinimo` y `calcularAlertasStock`): gana el de la sección si
 * existe, si no el global de la sucursal, si no `null` ("sin mínimo cargado"). Un 0 es un mínimo real y gana sobre el global: por eso es `??`
 * y no `||`.
 */
export function elegirMinimo(porSeccion: number | null | undefined, global: number | null | undefined): number | null {
  return porSeccion ?? global ?? null;
}

/** La escala de la columna `StockMinimoProducto.minimo` (`Decimal(14,4)`): dos mínimos son el mismo si coinciden a 4 decimales (lo que la base guarda). */
const ESCALA_DEL_MINIMO = 10_000;

/** Si dos mínimos son el mismo valor tal como los guarda la base (a 4 decimales). */
export function mismoMinimo(a: number, b: number): boolean {
  return Math.round(a * ESCALA_DEL_MINIMO) === Math.round(b * ESCALA_DEL_MINIMO);
}

/**
 * «Cambiar mínimo» con el valor que la persona VIO (Fase 7, DEC-27; invariante I8 de `docs/diseno-modulo-stock-2026-10-27.md`): qué hacer según lo que hay HOY en la base.
 *  - `SIN_CAMBIO`: ya tiene el valor pedido (un doble clic, o dos personas que pidieron lo mismo): éxito sin escribir ni auditar.
 *  - `CAMBIO_AJENO`: no tiene el valor que se vio (otra persona lo cambió o lo borró: `actual` null): no se escribe y se avisa.
 *  - `CAMBIAR`: sigue como se vio: se escribe (y la escritura vuelve a exigir el valor visto, por si otro ganó entre la lectura y el `UPDATE`).
 * El orden importa: «ya está como lo pedí» va antes que «no es lo que vi», así el doble clic no muestra «otra persona lo cambió». Puro.
 */
export type DecisionDeCambioDeMinimo = "SIN_CAMBIO" | "CAMBIO_AJENO" | "CAMBIAR";

export function decidirCambioDeMinimo(entrada: { actual: number | null; visto: number; nuevo: number }): DecisionDeCambioDeMinimo {
  const { actual, visto, nuevo } = entrada;
  if (actual !== null && mismoMinimo(actual, nuevo)) return "SIN_CAMBIO";
  if (actual === null || !mismoMinimo(actual, visto)) return "CAMBIO_AJENO";
  return "CAMBIAR";
}
