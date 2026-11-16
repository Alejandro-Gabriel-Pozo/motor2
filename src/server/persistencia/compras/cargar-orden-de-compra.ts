import "server-only";
import type { Prisma } from "@prisma/client";
import { CONTROL_RECEPCION_EXCEDE_LA_ORDEN, esNivelDeControl, type EstadoDeOrden, type MotivoDeCierre, type NivelDeControl } from "@/core/compras/public";

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

/** El nivel del control de exceso de la empresa; sin fila = `null` (la regla pura lo trata como PERMITIR). Un valor desconocido en la base se trata como BLOQUEAR (falla cerrado). */
export async function cargarNivelDelControlDeExceso(db: Db): Promise<NivelDeControl | null> {
  const fila = await db.nivelDeControl.findFirst({ where: { control: CONTROL_RECEPCION_EXCEDE_LA_ORDEN }, select: { nivel: true } });
  if (!fila) return null;
  return esNivelDeControl(fila.nivel) ? fila.nivel : "BLOQUEAR";
}

export interface LineaDeOrdenConSaldo {
  numero: number;
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  unidadNombre: string;
  decimales: number;
  cantidadPedida: number;
  precioPorUnidadStock: number | null;
  retirada: boolean;
  /** Lo recibido contra la línea; `null` mientras la orden no se pidió (el saldo nace al pedir). */
  cantidadRecibida: number | null;
}

export interface OrdenDeCompraVista {
  id: string;
  numero: number | null;
  estado: EstadoDeOrden;
  proveedorId: string;
  proveedorNombre: string;
  sucursalId: string | null;
  sucursalNombre: string | null;
  fechaDeEntregaPrevista: Date | null;
  fechaDeNegocio: Date | null;
  cierreMotivo: MotivoDeCierre | null;
  motivoDeAnulacion: string | null;
  creadoEn: Date;
  lineas: LineaDeOrdenConSaldo[];
}

const SELECCION = {
  id: true,
  numero: true,
  estado: true,
  proveedorId: true,
  sucursalId: true,
  fechaDeEntregaPrevista: true,
  fechaDeNegocio: true,
  cierreMotivo: true,
  motivoDeAnulacion: true,
  creadoEn: true,
  proveedor: { select: { nombre: true } },
  sucursal: { select: { nombre: true } },
  lineas: {
    orderBy: { numero: "asc" },
    select: {
      numero: true,
      productoId: true,
      cantidadPedida: true,
      precioPorUnidadStock: true,
      retirada: true,
      producto: { select: { codigo: true, nombre: true, unidadStock: { select: { nombre: true, decimales: true } } } },
      saldo: { select: { cantidadRecibida: true } },
    },
  },
} satisfies Prisma.OrdenDeCompraSelect;

type FilaDeOrden = Prisma.OrdenDeCompraGetPayload<{ select: typeof SELECCION }>;

function aVista(f: FilaDeOrden): OrdenDeCompraVista {
  return {
    id: f.id,
    numero: f.numero,
    estado: f.estado as EstadoDeOrden,
    proveedorId: f.proveedorId,
    proveedorNombre: f.proveedor.nombre,
    sucursalId: f.sucursalId,
    sucursalNombre: f.sucursal?.nombre ?? null,
    fechaDeEntregaPrevista: f.fechaDeEntregaPrevista,
    fechaDeNegocio: f.fechaDeNegocio,
    cierreMotivo: (f.cierreMotivo as MotivoDeCierre | null) ?? null,
    motivoDeAnulacion: f.motivoDeAnulacion,
    creadoEn: f.creadoEn,
    lineas: f.lineas.map((l) => ({
      numero: l.numero,
      productoId: l.productoId,
      productoCodigo: l.producto.codigo,
      productoNombre: l.producto.nombre,
      unidadNombre: l.producto.unidadStock.nombre,
      decimales: l.producto.unidadStock.decimales,
      cantidadPedida: Number(l.cantidadPedida),
      precioPorUnidadStock: l.precioPorUnidadStock === null ? null : Number(l.precioPorUnidadStock),
      retirada: l.retirada,
      cantidadRecibida: l.saldo ? Number(l.saldo.cantidadRecibida) : null,
    })),
  };
}

/** Una orden con sus líneas y saldos, o `null` (no existe o no se ve). */
export async function cargarOrdenDeCompra(db: Db, ordenId: string): Promise<OrdenDeCompraVista | null> {
  const f = await db.ordenDeCompra.findUnique({ where: { id: ordenId }, select: SELECCION });
  return f ? aVista(f) : null;
}

/** Las órdenes que se ven, las más nuevas primero (borradores primero por no tener número); tope de pedido, no una regla de negocio. */
export async function listarOrdenesDeCompra(db: Db, tope = 200): Promise<OrdenDeCompraVista[]> {
  const filas = await db.ordenDeCompra.findMany({ orderBy: [{ creadoEn: "desc" }, { id: "asc" }], take: tope, select: SELECCION });
  return filas.map(aVista);
}

/** Las órdenes PEDIDAS de un proveedor (lo que se puede recibir), con sus líneas y saldos: la lista que ofrece «Cargar compra» al elegir la orden. */
export async function listarOrdenesPedidasDelProveedor(db: Db, proveedorId: string): Promise<OrdenDeCompraVista[]> {
  const filas = await db.ordenDeCompra.findMany({ where: { proveedorId, estado: "PEDIDA" }, orderBy: [{ numero: "asc" }], take: 100, select: SELECCION });
  return filas.map(aVista);
}

export interface RenglonParaVincular {
  id: string;
  productoId: string | null;
  cantidadStock: number;
}

/** Las líneas de la orden que importan al vincular (con su saldo) para validar antes de escribir. */
export async function cargarLineasParaVincular(tx: Db, ordenId: string): Promise<Map<number, { productoId: string; retirada: boolean; pedida: number; recibida: number }>> {
  const filas = await tx.lineaDeOrdenDeCompra.findMany({ where: { ordenId }, select: { numero: true, productoId: true, retirada: true, cantidadPedida: true, saldo: { select: { cantidadRecibida: true } } } });
  return new Map(filas.map((l) => [l.numero, { productoId: l.productoId, retirada: l.retirada, pedida: Number(l.cantidadPedida), recibida: l.saldo ? Number(l.saldo.cantidadRecibida) : 0 }]));
}

/** La orden a la que apunta una compra (para el nombre en la bandeja «Por recibir»): por renglón de factura → número de la orden. */
export async function cargarNumerosDeOrdenPorRenglon(db: Db, renglonIds: readonly string[]): Promise<Map<string, { numero: number | null; lineaDeOrden: number }>> {
  if (renglonIds.length === 0) return new Map();
  const filas = await db.vinculoDeRenglonConOrden.findMany({ where: { facturaProveedorRenglonId: { in: [...renglonIds] } }, select: { facturaProveedorRenglonId: true, lineaDeOrden: true, orden: { select: { numero: true } } } });
  return new Map(filas.map((v) => [v.facturaProveedorRenglonId, { numero: v.orden.numero, lineaDeOrden: v.lineaDeOrden }]));
}
