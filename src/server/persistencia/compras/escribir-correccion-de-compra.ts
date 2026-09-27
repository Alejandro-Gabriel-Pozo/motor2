import "server-only";
import type { Prisma } from "@prisma/client";
import type { CabeceraCompra } from "@/core/compras/correccion";

/**
 * Escritura de la CORRECCIÓN de la cabecera de una compra (Task #41, Fase M; `tx` obligatorio, sin reglas de negocio). Es EXACTAMENTE
 * el `update` que antes hacía en línea `corregirCompra`: los tres campos de la cabecera, nunca las líneas del Kardex. La auditoría por
 * campo la escribe el caso de uso.
 */
export async function escribirCorreccionDeCompra(tx: Prisma.TransactionClient, compraId: string, cabecera: CabeceraCompra): Promise<void> {
  await tx.operacion.update({
    where: { id: compraId },
    data: { proveedorId: cabecera.proveedorId, nroFactura: cabecera.nroFactura, detalleLibre: cabecera.detalleLibre },
  });
}
