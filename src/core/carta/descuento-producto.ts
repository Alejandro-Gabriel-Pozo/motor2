import { precioConDescuento } from "@/core/moneda";

/**
 * Producto con descuento (decisión del dueño, 2026-10-01): un PV puede tener, en UNA sucursal, un descuento en PORCENTAJE sobre el precio que
 * rige ahí (el local habilitado o, si no, el global). No es una promoción. Una sola definición del cálculo, para que la carta, el selector del POS,
 * el alta a la cuenta y el reporte nunca discrepen. Pura: no toca la base. El % lo valida `validarPorcentajeDescuento` (0 < % < 100).
 */
export interface PrecioConDescuentoDeProducto {
  /** Lo que se cobra: el precio vigente menos el descuento (nunca menos de $0,01, como el descuento del cliente). */
  precio: number;
  /** El precio vigente sin descuento, SOLO si hubo descuento: es lo que se muestra tachado y lo que se guarda como precio de lista. */
  precioLista: number | null;
  /** El % aplicado, o null si no hay descuento. */
  porcentaje: number | null;
}

/** Lo que se cobra de una línea con los dos descuentos posibles, y de cuál de los dos viene. */
export interface PrecioCobradoConDescuentos {
  precio: number;
  /** Lo que se mostraría tachado: el precio de lista, SOLO si hay algún descuento (de producto o de cliente). */
  precioLista: number | null;
  /** Qué descuento rige: el de producto (ya estaba en el precio congelado), el del cliente, o ninguno. */
  origen: "producto" | "cliente" | null;
}

/**
 * Descuento de producto + descuento del cliente: rige SOLO EL MAYOR, nunca los dos en cascada (decisión del dueño, 2026-10-01). `precioUnitario` es
 * el precio congelado en la cuenta (ya con el descuento de producto, si lo había) y `precioLista` el precio vigente sin ese descuento (`CuentaItem.
 * precioCartaUnitario` de un suelto; null si no hubo descuento de producto). Se compara lo que costaría con cada descuento: gana el más barato, y
 * con empate gana el de producto. Es la ÚNICA definición: el cierre, el ticket, el reporte de tickets y el total de la mesa la usan.
 */
export function precioCobradoConDescuentos(precioUnitario: number, precioLista: number | null, descuentoCliente: number | null): PrecioCobradoConDescuentos {
  if (precioLista === null || precioLista <= precioUnitario) {
    const precio = precioConDescuento(precioUnitario, descuentoCliente);
    return precio !== precioUnitario ? { precio, precioLista: precioUnitario, origen: "cliente" } : { precio, precioLista: null, origen: null };
  }
  const conClienteSobreLista = precioConDescuento(precioLista, descuentoCliente);
  return conClienteSobreLista < precioUnitario ? { precio: conClienteSobreLista, precioLista, origen: "cliente" } : { precio: precioUnitario, precioLista, origen: "producto" };
}

/**
 * Los descuentos de producto que RIGEN en la sucursal: los configurados, solo si la sucursal tiene prendida la capacidad `precio_local` (decisión
 * del dueño, 2026-10-01, R1: con el precio propio de la sucursal apagado, tampoco rige su descuento). Los configurados no se borran: vuelven a
 * regir al reactivarla. Pura.
 */
export function descuentosVigentes(configurados: ReadonlyMap<string, number>, precioLocalActivo: boolean): Map<string, number> {
  return precioLocalActivo ? new Map(configurados) : new Map();
}

export function aplicarDescuentoDeProducto(precioVigente: number, porcentaje: number | null | undefined): PrecioConDescuentoDeProducto {
  if (!porcentaje || porcentaje <= 0) return { precio: precioVigente, precioLista: null, porcentaje: null };
  const precio = precioConDescuento(precioVigente, porcentaje);
  if (precio === precioVigente) return { precio: precioVigente, precioLista: null, porcentaje: null };
  return { precio, precioLista: precioVigente, porcentaje };
}
