import "server-only";
import type { Prisma } from "@prisma/client";
import type { EstadoDeOrden } from "@/core/compras/public";

/**
 * Compras, orden de compra (etapa OC): las LECTURAS de los casos de uso de la orden y del vínculo de una compra con ella, dentro de su transacción (o con la base del contexto). Sin reglas de negocio; `Decimal` → `number` en el borde. Lo que se lee con el
 * alcance del contexto: la RLS por sucursal esconde las órdenes destinadas a otra sucursal (`sucursalId` de la orden; NULL = de toda la empresa).
 */

type Db = Prisma.TransactionClient;

export interface OrdenBloqueada {
  id: string;
  proveedorId: string;
  sucursalId: string | null;
  estado: EstadoDeOrden;
  numero: number | null;
  fechaDeEntregaPrevista: Date | null;
}

/**
 * Toma la fila de la cabecera con `SELECT … FOR UPDATE` (primera sentencia de pedir, anular y cerrar): serializa esos tres comandos entre sí y contra el registro de un vínculo (que toma la orden `FOR SHARE`). `null` si no existe o no se ve
 * (otra empresa, o destinada a una sucursal fuera del alcance).
 */
export async function bloquearOrden(tx: Db, ordenId: string): Promise<OrdenBloqueada | null> {
  const filas = await tx.$queryRaw<OrdenBloqueada[]>`
    SELECT "id", "proveedorId", "sucursalId", "estado", "numero", "fechaDeEntregaPrevista" FROM "OrdenDeCompra" WHERE "id" = ${ordenId}::uuid FOR UPDATE`;
  return filas[0] ?? null;
}

/** La huella y el id de la orden que lleva esa clave de reintento, o `null`. La clave es única global (ADR-028). */
export async function cargarOrdenPorClaveIdempotencia(db: Db, claveIdempotencia: string): Promise<{ id: string; payloadHash: string } | null> {
  return db.ordenDeCompra.findUnique({ where: { claveIdempotencia }, select: { id: true, payloadHash: true } });
}

/** Cuántas líneas de la orden no se retiraron (el disparador de la base exige al menos una para pedir). */
export async function contarLineasNoRetiradas(tx: Db, ordenId: string): Promise<number> {
  return tx.lineaDeOrdenDeCompra.count({ where: { ordenId, retirada: false } });
}

/** ¿Hay compras vigentes contra la orden? `soloPendientes` = solo las que siguen pendientes de recibir. Vigente = factura no anulada. Lo que se ve depende del alcance del contexto: quien cierra o anula abre la transacción con la base de VERIFICACIÓN. */
export async function hayCompraContraLaOrden(tx: Db, ordenId: string, soloPendientes: boolean): Promise<boolean> {
  const n = await tx.vinculoDeRenglonConOrden.count({
    where: { ordenId, parte: { ...(soloPendientes ? { estadoRecepcion: "PENDIENTE" } : {}), facturaProveedor: { anuladaEn: null } } },
  });
  return n > 0;
}

/** Las líneas de la orden que importan al vincular (con su saldo) para validar antes de escribir. */
export async function cargarLineasParaVincular(tx: Db, ordenId: string): Promise<Map<number, { productoId: string; retirada: boolean; pedida: number; recibida: number }>> {
  const filas = await tx.lineaDeOrdenDeCompra.findMany({ where: { ordenId }, select: { numero: true, productoId: true, retirada: true, cantidadPedida: true, saldo: { select: { cantidadRecibida: true } } } });
  return new Map(filas.map((l) => [l.numero, { productoId: l.productoId, retirada: l.retirada, pedida: Number(l.cantidadPedida), recibida: l.saldo ? Number(l.saldo.cantidadRecibida) : 0 }]));
}
