/**
 * Formatos de la pantalla de la mesa (compartidos por la página y sus componentes de cliente). Vive en `core/pos` (y no en la
 * carpeta de rutas del POS, `(pos)/mesas/[mesaId]/`) para que un reporte de `(app)` (el reporte de boletas emitidas, Task #17)
 * también pueda formatear sin duplicar los `Intl.NumberFormat`. Las horas (con la zona de la empresa) viven en `core/tiempo`.
 */
const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const CANTIDAD = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });

export function formatearMonto(n: number): string {
  return MONEDA.format(n);
}

export function formatearCantidad(n: number): string {
  return CANTIDAD.format(n);
}

/** «Mesa 04»: mismo formato de número que la tarjeta del mapa. */
export function nombreDeMesa(numero: number): string {
  return `Mesa ${String(numero).padStart(2, "0")}`;
}
