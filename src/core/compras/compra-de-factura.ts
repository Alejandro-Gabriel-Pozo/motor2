/**
 * E3a, paso 6 (docs/diseno-factura-de-proveedor-e3a-2026-10-27.md, invariante D8): la compra de UNA parte de una factura de proveedor no se anula ni se corrige suelta.
 *
 * La factura es un documento de la empresa (ADR-029) cuyas partes son compras (`Operacion` COMPRA) de cada sucursal, con sus líneas del Kardex atadas a un renglón
 * (`MovimientoStock.facturaProveedorRenglonId`). Anular solo la compra de una parte dejaría la factura «vigente» con una parte sin stock, y corregir su proveedor o su
 * número dejaría la compra diciendo otra cosa que la cabecera. Por eso `anularCompra` y `corregirCompra` la rechazan y mandan a la factura: anularla entera (con todas sus
 * partes, atómica) y, si hace falta, volver a cargarla.
 *
 * Pura: quien llama sabe si la compra es de una factura (alguna de sus líneas tiene renglón) y decide con esto.
 */

type AccionSobreCompraDeFactura = "anular" | "corregir";

const MENSAJES_COMPRA_DE_FACTURA: Readonly<Record<AccionSobreCompraDeFactura, string>> = {
  anular:
    "Esta compra es la parte de una factura de proveedor y no se anula sola: anulá la factura entera desde «Facturas de proveedor» (vuelve atrás todas sus partes y libera el número).",
  corregir:
    "Esta compra es la parte de una factura de proveedor: sus datos son los de la factura y no se corrigen en una de sus compras. Si hay un error, anulá la factura entera y volvé a cargarla.",
};

/** `null` si la compra no es de una factura (se sigue como siempre); si lo es, el rechazo con su código y su mensaje. */
export function rechazoPorCompraDeFactura(esDeFactura: boolean, accion: AccionSobreCompraDeFactura): { motivo: "COMPRA_DE_FACTURA"; mensaje: string } | null {
  return esDeFactura ? { motivo: "COMPRA_DE_FACTURA", mensaje: MENSAJES_COMPRA_DE_FACTURA[accion] } : null;
}
