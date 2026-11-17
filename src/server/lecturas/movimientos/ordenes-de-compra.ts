import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { diaDeColumnaDate, ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { avanceDeRecepcionDeOrden, CONTROL_RECEPCION_EXCEDE_LA_ORDEN, esNivelDeControl, type AvanceDeRecepcionDeOrden, type EstadoDeOrden, type MotivoDeCierre, type NivelDeControl } from "@/core/compras/public";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Compras, orden de compra (etapa OC): las LECTURAS compartidas entre las pantallas de órdenes, el selector de «Cargar compra» y los casos de uso que necesitan el nivel del control (ADR-026). Solo lectura, con `select` (nunca la fila entera), `Decimal` → `number`
 * en el borde y fechas como texto `AAAA-MM-DD` (día argentino). La RLS por sucursal esconde las órdenes destinadas a otra sucursal (NULL = de toda la empresa). El DINERO (el precio por unidad de cada línea) solo viaja si `conPrecios` (quien gestiona las
 * órdenes: piso administrador, GT-1): el selector de la compra y quien solo ve las órdenes no lo reciben nunca. Sin guarda de permiso adentro: la página o la Server Action ya pidieron `orden_de_compra_ver`.
 */

/** El nivel del control de exceso de la empresa; sin fila = `null` (la regla pura lo trata como PERMITIR). Un valor desconocido en la base se trata como BLOQUEAR (falla cerrado). */
export async function cargarNivelDelControlDeExceso(db: Db): Promise<NivelDeControl | null> {
  const fila = await db.nivelDeControl.findFirst({ where: { control: CONTROL_RECEPCION_EXCEDE_LA_ORDEN }, select: { nivel: true } });
  if (!fila) return null;
  return esNivelDeControl(fila.nivel) ? fila.nivel : "BLOQUEAR";
}

interface LineaDeOrdenConSaldo {
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

interface OrdenDeCompraVista {
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

/** Las órdenes que se ven, las más nuevas primero (borradores primero por no tener número); tope de pedido, no una regla de negocio. */
async function listarOrdenesDeCompra(db: Db, tope = 200): Promise<OrdenDeCompraVista[]> {
  const filas = await db.ordenDeCompra.findMany({ orderBy: [{ creadoEn: "desc" }, { id: "asc" }], take: tope, select: SELECCION });
  return filas.map(aVista);
}

/** Las órdenes PEDIDAS de un proveedor (lo que se puede recibir), con sus líneas y saldos: la lista que ofrece «Cargar compra» al elegir la orden. */
async function listarOrdenesPedidasDelProveedor(db: Db, proveedorId: string): Promise<OrdenDeCompraVista[]> {
  const filas = await db.ordenDeCompra.findMany({ where: { proveedorId, estado: "PEDIDA" }, orderBy: [{ numero: "asc" }], take: 100, select: SELECCION });
  return filas.map(aVista);
}

export interface LineaDeOrdenParaMostrar {
  numero: number;
  productoNombre: string;
  unidadNombre: string;
  productoId: string;
  decimales: number;
  cantidadPedida: number;
  /** Lo recibido contra la línea; `null` mientras la orden no se pidió. */
  cantidadRecibida: number | null;
  retirada: boolean;
  /** Solo con `conPrecios`. */
  precioPorUnidadStock?: number | null;
}

export interface OrdenParaMostrar {
  id: string;
  numero: number | null;
  estado: EstadoDeOrden;
  proveedorNombre: string;
  sucursalNombre: string | null;
  fechaDeEntregaPrevista: string | null;
  cierreMotivo: MotivoDeCierre | null;
  motivoDeAnulacion: string | null;
  creadaEl: string;
  /** Cómo va la recepción (se calcula del saldo, no se guarda); solo en una orden pedida o cerrada. */
  avance: AvanceDeRecepcionDeOrden | null;
  lineas: LineaDeOrdenParaMostrar[];
}

function aMostrar(o: OrdenDeCompraVista, conPrecios: boolean): OrdenParaMostrar {
  const conSaldo = o.estado === "PEDIDA" || o.estado === "CERRADA";
  return {
    id: o.id,
    numero: o.numero,
    estado: o.estado,
    proveedorNombre: o.proveedorNombre,
    sucursalNombre: o.sucursalNombre,
    fechaDeEntregaPrevista: o.fechaDeEntregaPrevista ? diaDeColumnaDate(o.fechaDeEntregaPrevista) : null,
    cierreMotivo: o.cierreMotivo,
    motivoDeAnulacion: o.motivoDeAnulacion,
    creadaEl: diaDeCalendario(o.creadoEn, ZONA_ARGENTINA),
    avance: conSaldo ? avanceDeRecepcionDeOrden(o.lineas.filter((l) => !l.retirada).map((l) => ({ cantidadPedida: l.cantidadPedida, cantidadRecibida: l.cantidadRecibida ?? 0 }))) : null,
    lineas: o.lineas.map((l) => ({
      numero: l.numero,
      productoId: l.productoId,
      productoNombre: l.productoNombre,
      unidadNombre: l.unidadNombre,
      decimales: l.decimales,
      cantidadPedida: l.cantidadPedida,
      cantidadRecibida: l.cantidadRecibida,
      retirada: l.retirada,
      ...(conPrecios ? { precioPorUnidadStock: l.precioPorUnidadStock } : {}),
    })),
  };
}

/** Las órdenes que ve quien consulta (la RLS por sucursal esconde las destinadas a otra sucursal), las más nuevas primero. */
export async function listarOrdenesParaMostrar(db: Db, conPrecios: boolean): Promise<OrdenParaMostrar[]> {
  return (await listarOrdenesDeCompra(db)).map((o) => aMostrar(o, conPrecios));
}

/** Las órdenes PEDIDAS de un proveedor, sin precios, para elegir una al cargar una compra. */
export async function listarOrdenesPedidasParaElegir(db: Db, proveedorId: string): Promise<OrdenParaMostrar[]> {
  return (await listarOrdenesPedidasDelProveedor(db, proveedorId)).map((o) => aMostrar(o, false));
}


/** Los proveedores ACTIVOS (id y nombre) que se ofrecen al armar una orden nueva: solo la página de órdenes los pide, y solo a quien gestiona las órdenes (la página ya exigió `orden_de_compra_ver` y mira `orden_de_compra_gestionar`). */
export async function listarProveedoresParaOrden(db: Db): Promise<{ id: string; nombre: string }[]> {
  return db.proveedor.findMany({ where: { activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } });
}
