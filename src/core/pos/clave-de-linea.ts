/**
 * La clave con la que se agrupan y se enlazan las líneas de una cuenta (producto, precio congelado, promo y, en un suelto con descuento de
 * producto, su precio de lista): una sola definición para `lineasDeVenta`, el ticket y el reporte de tickets emitidos.
 *
 * Vive en su propio archivo (GO-2b) para cortar el ciclo `cuenta.ts` ↔ `clave-de-linea-con-opciones.ts`: la clave con opciones se arma sobre esta, y
 * `lineasDeVenta` (en `cuenta.ts`) usa la clave con opciones. `cuenta.ts` la reexporta tal cual: quien la importaba de ahí sigue igual.
 */
export function claveDeLineaDeVenta(l: { productoId: string; precioUnitario: number; promoCuentaId?: string | null; precioCartaUnitario?: number | null }): string {
  const promoCuentaId = l.promoCuentaId ?? "";
  const lista = !promoCuentaId && l.precioCartaUnitario != null ? String(l.precioCartaUnitario) : "";
  return `${l.productoId}|${l.precioUnitario}|${promoCuentaId}${lista ? `|${lista}` : ""}`;
}
