import "server-only";
import type { Prisma } from "@prisma/client";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { upsertProveedorPorProducto } from "@/server/persistencia/catalogo/upsert-proveedor-por-producto";

/**
 * COMANDO DE CATÁLOGO (Fase 2b, D2; DEC-36: `ProveedorPorProducto` es de Catálogo): el vínculo proveedor↔producto de UNA línea de una Compra, con su
 * auditoría. No es un caso de uso (no lo importa ninguna Server Action): lo invoca el registro de una Compra de Movimientos
 * (`movimientos/casos-de-uso/registrar-movimiento.ts`) DENTRO de su propia transacción, así Movimientos ya no toca la persistencia de Catálogo (regla R2).
 * Declarado en `COMANDOS_PUBLICOS` (`.dependency-cruiser-excepciones.cjs`, regla R3).
 *
 * Movido TAL CUAL del caso de uso de Movimientos (mismo orden: el upsert —`upsertProveedorPorProducto`, que lee el precio anterior dentro de la misma
 * transacción— y, después, la fila de auditoría del precio por unidad de stock; decisión del dueño, 2026-10-08). Una compra con fecha atrasada no
 * cambia el precio (el SQL no lo pisa) y por lo tanto no deja fila. Recibe el cliente de la transacción de quien llama: si falla el vínculo o su
 * auditoría, falla la compra entera (decisión del dueño, 2026-10-06).
 */
export async function registrarVinculoDeCompraEnTx(
  tx: Prisma.TransactionClient,
  actor: { usuarioId: string; sucursalId: string },
  linea: {
    productoId: string;
    proveedorId: string;
    unidadCompraId: string;
    precioUnitario: number;
    precioPorUnidadStock: number;
    fechaCompra?: Date;
    referenciaProveedor?: string;
  },
): Promise<void> {
  const vinculo = await upsertProveedorPorProducto(tx, linea);
  // Auditoría (decisión del dueño, 2026-10-08): el precio del vínculo proveedor↔producto es plata que cambia con cada compra; si cambió (o el par es nuevo), deja su fila.
  await registrarCambioAuditado(tx, {
    entidad: "ProveedorPorProducto",
    entidadId: `${linea.productoId}:${linea.proveedorId}:${linea.unidadCompraId}`,
    campo: "precioPorUnidadStock",
    descripcion: `Precio de "${vinculo.productoNombre}" con el proveedor "${vinculo.proveedorNombre}" (compra)`,
    valorAnterior: vinculo.precioAnterior,
    valorNuevo: vinculo.precioNuevo,
    actorId: actor.usuarioId,
    sucursalId: actor.sucursalId,
  });
}
