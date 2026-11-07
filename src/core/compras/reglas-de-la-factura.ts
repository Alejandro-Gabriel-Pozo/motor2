/**
 * U1 de «una sola compra» (docs/diseno-una-sola-compra-2026-11-06.md §8.2 y §8.3): las reglas PURAS de la factura entera que no dependen del stock de cada parte. Sin base, sin Prisma, sin reloj. Las aplican los casos de uso de
 * anular y de corregir los datos de la factura con la cabecera bloqueada, y el oráculo `docs/oraculo-combinaciones-una-sola-compra-2026-11-06.md` las contrasta combinación por combinación. La regla de «lo comprado sigue en stock»
 * (devolución o venta de una parte) es `evaluarAnulacion`; la del pago, `decidirDeclaracionDePago`.
 */

export type CodigoDeRechazoDeAnulacionDeFactura = "YA_ANULADA" | "CON_NOTAS_DE_CREDITO";
export type DecisionSobreLaFactura<C extends string> = { ok: true } | { ok: false; codigo: C; mensaje: string };

/** ¿Se puede anular la factura entera? Primero «ya está anulada»; después, una nota de crédito vigente la ata (hay que anular la nota antes). */
export function decidirAnulacionDeFactura(e: { anulada: boolean; notasVigentes: boolean }): DecisionSobreLaFactura<CodigoDeRechazoDeAnulacionDeFactura> {
  if (e.anulada) return { ok: false, codigo: "YA_ANULADA", mensaje: "La factura ya está anulada." };
  if (e.notasVigentes) return { ok: false, codigo: "CON_NOTAS_DE_CREDITO", mensaje: "La factura tiene notas de crédito vigentes: primero hay que anularlas." };
  return { ok: true };
}

export type CodigoDeRechazoDeCorreccionDeFactura = "YA_ANULADA" | "CON_NOTAS_DE_CREDITO";

/**
 * ¿Se pueden corregir los datos (proveedor, número, detalle) de la factura? Una factura anulada no se corrige. Cambiar el PROVEEDOR se rechaza si la factura tiene alguna nota de crédito, vigente o anulada (la base ata la nota al proveedor de su
 * factura: `NotaCreditoProveedor_factura_fkey`, ON UPDATE RESTRICT); el número y el detalle se corrigen igual.
 */
export function decidirCorreccionDeDatos(e: { anulada: boolean; cambiaElProveedor: boolean; tieneNotas: boolean }): DecisionSobreLaFactura<CodigoDeRechazoDeCorreccionDeFactura> {
  if (e.anulada) return { ok: false, codigo: "YA_ANULADA", mensaje: "Una compra anulada no se puede corregir." };
  if (e.cambiaElProveedor && e.tieneNotas) return { ok: false, codigo: "CON_NOTAS_DE_CREDITO", mensaje: "La factura tiene notas de crédito: no se puede cambiar el proveedor (el número y el detalle sí). Si el proveedor está mal, anulá la factura (primero sus notas de crédito) y cargala de nuevo." };
  return { ok: true };
}
