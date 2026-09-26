/**
 * Formatos de la pantalla de la mesa (compartidos por la página y sus componentes de cliente). Vive en `core/pos` (y no en la
 * carpeta de rutas del POS, `(pos)/mesas/[mesaId]/`) para que un reporte de `(app)` (el reporte de boletas emitidas, Task #17)
 * también pueda formatear en hora de Argentina sin duplicar los `Intl.DateTimeFormat` — movido en un commit propio, mecánico, sin
 * cambiar ningún formato.
 */
const MONEDA = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const CANTIDAD = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 });
const HORA = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" });
/** Hora de Argentina, como el mapa de mesas (src/app/(pos)/mesas/page.tsx): el servidor y el navegador pueden estar en otra zona. */
const FECHA_HORA = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "America/Argentina/Buenos_Aires",
});

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

/** «25/09/2026 15:10», hora de Argentina: la de los documentos impresos (comanda y boleta). */
export function formatearFechaHora(fecha: Date): string {
  const partes = Object.fromEntries(FECHA_HORA.formatToParts(fecha).map((p) => [p.type, p.value]));
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`;
}

/** «15:10», hora de Argentina («Cuentas cerradas»). */
export function formatearHora(fecha: Date): string {
  return HORA.format(fecha);
}
