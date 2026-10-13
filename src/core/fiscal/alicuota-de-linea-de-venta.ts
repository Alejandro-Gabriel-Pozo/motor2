import type { AlicuotaIva } from "./iva";

/**
 * La alícuota de IVA de una línea de venta (GO-0b; diseño §2.12). Una sola función pura la deriva para TODAS las líneas:
 * - una línea común: la alícuota de su propio producto;
 * - una línea ADICIONAL (cuelga de la línea de otro producto, su «padre»): la alícuota del producto de su línea PADRE, no la del producto que la respalda en el Kardex.
 *   La foto fiscal la toma la emisión para todas las líneas a la vez; una alícuota propia del adicional podría contradecir la del padre en el mismo comprobante.
 * - alícuota NULL («sin declarar», `Producto.alicuotaIvaVenta` de M0-IVA): resultado explícito `declarada: false`. Acá NO se rechaza nada: la emisión fiscal falla cerrada
 *   cuando ve ese resultado, como hoy con un producto sin alícuota. Nunca se supone una alícuota por defecto.
 *
 * Recibe solo lo que necesita (no el producto entero): quien llama (la emisión, GO-2) resuelve el padre por `lineaPadreId` / `operacionPadreId`.
 */
export interface LineaParaAlicuota {
  /** `Producto.alicuotaIvaVenta` del producto de la línea. */
  alicuotaDelProducto: AlicuotaIva | null;
  /** Solo en un adicional: el producto de la línea padre. Ausente o `null` = no es un adicional. */
  padre?: { alicuotaDelProducto: AlicuotaIva | null } | null;
}

export type AlicuotaDeLinea = { declarada: true; alicuota: AlicuotaIva } | { declarada: false };

export function alicuotaDeLineaDeVenta(linea: LineaParaAlicuota): AlicuotaDeLinea {
  const alicuota = linea.padre ? linea.padre.alicuotaDelProducto : linea.alicuotaDelProducto;
  return alicuota === null ? { declarada: false } : { declarada: true, alicuota };
}
