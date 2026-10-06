import "server-only";
import type { Prisma } from "@prisma/client";
import type { CabeceraCompra } from "@/core/compras/public";

/**
 * Lecturas de la CORRECCIÓN de la cabecera de una compra (Task #41, Fase M; mismo contrato que `cargar-compra-para-anular.ts`: `tx`
 * obligatorio, tipos de dominio, sin reglas de negocio). Son EXACTAMENTE las tres consultas que antes hacía en línea `corregirCompra`
 * (src/server/actions/movimientos/compras.ts); CUÁNDO se llama cada una lo decide el caso de uso.
 */

/** La compra tal como la necesita el caso de uso `corregirCompra`. `proceso` puede no ser COMPRA: eso lo rechaza el caso de uso. */
export interface CompraParaCorregir {
  id: string;
  proceso: string;
  anuladaEn: Date | null;
  fecha: Date;
  /** Lo que hoy está guardado de los campos corregibles. */
  cabecera: CabeceraCompra;
  /** Nombre del proveedor ACTUAL (para la auditoría, que guarda nombres y no ids); `null` si no tiene. */
  proveedorNombre: string | null;
}

/** `null` si no hay ninguna operación con ese id en esta sucursal. */
export async function cargarCompraParaCorregir(
  tx: Prisma.TransactionClient,
  args: { operacionId: string; sucursalId: string }
): Promise<CompraParaCorregir | null> {
  const operacion = await tx.operacion.findFirst({
    where: { id: args.operacionId, sucursalId: args.sucursalId },
    include: { proveedor: { select: { nombre: true } } },
  });
  if (!operacion) return null;
  return {
    id: operacion.id,
    proceso: operacion.proceso,
    anuladaEn: operacion.anuladaEn,
    fecha: operacion.fecha,
    cabecera: { proveedorId: operacion.proveedorId, nroFactura: operacion.nroFactura, detalleLibre: operacion.detalleLibre },
    proveedorNombre: operacion.proveedor?.nombre ?? null,
  };
}

/** El proveedor nuevo pedido: `null` si no existe. */
export async function cargarProveedorParaCorreccion(tx: Prisma.TransactionClient, proveedorId: string): Promise<{ nombre: string; activo: boolean } | null> {
  return tx.proveedor.findUnique({ where: { id: proveedorId }, select: { nombre: true, activo: true } });
}

/** ¿Hay OTRA compra vigente (no anulada) de esta sucursal con el mismo proveedor + N.º de factura? Mismo criterio que el índice único parcial. */
export async function hayOtraCompraVigenteConFactura(
  tx: Prisma.TransactionClient,
  args: { sucursalId: string; proveedorId: string; nroFactura: string; excluirOperacionId: string }
): Promise<boolean> {
  const otra = await tx.operacion.findFirst({
    where: {
      sucursalId: args.sucursalId,
      proceso: "COMPRA",
      proveedorId: args.proveedorId,
      nroFactura: args.nroFactura,
      anuladaEn: null,
      id: { not: args.excluirOperacionId },
    },
    select: { id: true },
  });
  return otra !== null;
}
