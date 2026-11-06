import "server-only";
import type { Prisma } from "@prisma/client";
import { upsertProveedorPorProducto } from "@/server/persistencia/catalogo/upsert-proveedor-por-producto";

/**
 * COMANDO DE CATÁLOGO (Fase 2b, D2; DEC-36: `ProveedorPorProducto` es de Catálogo): el vínculo proveedor↔producto de UNA línea de una Compra. No es un caso de uso (no lo importa ninguna
 * Server Action): lo invoca el registro de una Compra de Movimientos (`movimientos/casos-de-uso/registrar-movimiento.ts`) DENTRO de su propia transacción, así Movimientos ya no toca la
 * persistencia de Catálogo (regla R2). Declarado en `COMANDOS_PUBLICOS` (`.dependency-cruiser-excepciones.cjs`, regla R3).
 *
 * Recibe el cliente de la transacción de quien llama: si falla el vínculo, falla la compra entera (decisión del dueño, 2026-10-06).
 *
 * PODA (decisión del dueño, 2026-11-06): ya no guarda el precio del vínculo ni deja su fila de auditoría (la de 2026-10-08): ningún lector usa ese precio y cada compra conserva el suyo,
 * inmutable, en el Kardex. Se guardan la unidad de compra, la referencia del proveedor y la fecha de la última compra.
 */
export async function registrarVinculoDeCompraEnTx(
  tx: Prisma.TransactionClient,
  linea: {
    productoId: string;
    proveedorId: string;
    unidadCompraId: string;
    fechaCompra?: Date;
    referenciaProveedor?: string;
  },
): Promise<void> {
  await upsertProveedorPorProducto(tx, linea);
}
