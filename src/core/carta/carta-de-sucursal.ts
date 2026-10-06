/** Lo que un `where` de lectura de la estructura de carta de UNA sucursal recibe para quedarse con ella. */
export type FiltroDeCartaDeSucursal = { sucursalId: string };

/**
 * El filtro por sucursal de las lecturas de la estructura de carta PROPIA de cada sucursal (ADR-009, C3; decisión del dueño 2026-10-02):
 * GeneroCarta, ItemAgrupadoCarta, ContenidoCartaProducto y OpcionItemAgrupadoCarta, ya sea leídos directo (`db.generoCarta.findMany`)
 * o por la relación del producto (`contenidosCarta`, `opcionesItemAgrupadoCarta`). Las SECCIONES de carta (SeccionCarta) siguen siendo
 * de la empresa y NO llevan este filtro. `test/arquitectura/carta-estructura-lectores-inventariados.test.ts` exige esta llamada en
 * CADA lectura de esos cuatro modelos.
 */
export function whereCartaDeSucursal(sucursalId: string): FiltroDeCartaDeSucursal {
  return { sucursalId };
}
