/**
 * IVA (M0-IVA, Paquete 2): los códigos de alícuota del producto. Son identificadores SEMÁNTICOS, no el porcentaje ni el código de ARCA (eso lo traduce el adaptador fiscal):
 * así no hay coma decimal ni ambigüedad entre 0 %, exento y no gravado.
 *
 * La lista es la misma que el CHECK de `Producto.alicuotaIvaVenta` y `Producto.alicuotaIvaCompra` en la base (migración `20261015100000_m0_iva_alicuotas_de_producto`); un test de
 * paridad compara las dos. Ampliarla es ampliar el CHECK y esta lista a la vez.
 *
 * `NO_CORRESPONDE` NO está acá a propósito: no es una propiedad del producto sino la alícuota efectiva de una venta cuando el emisor no es Responsable Inscripto.
 * Sin funciones y sin Prisma: solo constantes y tipos puros.
 */
export const ALICUOTAS_IVA = ["IVA_0", "IVA_2_5", "IVA_5", "IVA_10_5", "IVA_21", "IVA_27", "EXENTO", "NO_GRAVADO"] as const;
export type AlicuotaIva = (typeof ALICUOTAS_IVA)[number];
