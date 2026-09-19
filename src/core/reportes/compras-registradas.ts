import { prisma } from "@/lib/db";
import { redondearMoneda } from "@/core/movimientos/transiciones";
import type { Db } from "./comun";
import { SIN_PROVEEDOR } from "./compras-filtros";

/**
 * Listado de compras registradas, una fila por FACTURA (una `Operacion` de proceso COMPRA), con sus líneas. Hasta ahora una compra solo se
 * veía por el historial de un producto o por su ID de operación: no había forma de ver «qué se le compró a este proveedor, con qué factura,
 * cuándo y por cuánto». Es de solo lectura (no edita ni anula nada; eso es otra fase, ver
 * docs/grounding-compras-correccion-y-notas-de-credito-2026-09-19.md, K1b a K1d).
 *
 * `proveedorId === SIN_PROVEEDOR` filtra las compras cargadas sin proveedor. Paginado por cursor (más recientes primero).
 */
export { SIN_PROVEEDOR };
export const TAMANO_PAGINA_COMPRAS = 30;

export interface FiltroCompras {
  desde?: Date;
  hasta?: Date;
  /** Id de un proveedor, o `SIN_PROVEEDOR` para las compras sin proveedor. */
  proveedorId?: string;
  /** Texto contenido en el N.º de factura (sin distinguir mayúsculas). */
  factura?: string;
  cursor?: string;
}

export interface LineaCompra {
  idMovimiento: string;
  productoCodigo: string;
  productoNombre: string;
  cantidad: number;
  unidad: string;
  loteVencimiento: Date | null;
  precioTotal: number;
  precioPorUnidadStock: number;
  seccionNombre: string;
}

export interface CompraRegistrada {
  idOperacion: string;
  fecha: Date;
  proveedorId: string | null;
  proveedorNombre: string | null;
  nroFactura: string | null;
  cargadaPor: string;
  detalle: string | null;
  total: number;
  /** Alguna línea se cargó sin precio: el total no es el de la factura. */
  hayLineasSinPrecio: boolean;
  lineas: LineaCompra[];
}

export interface PaginaCompras {
  items: CompraRegistrada[];
  nextCursor: string | null;
}

export async function listarComprasRegistradas(sucursalId: string, filtro: FiltroCompras = {}, db: Db = prisma): Promise<PaginaCompras> {
  const { desde, hasta, proveedorId, factura, cursor } = filtro;

  const operaciones = await db.operacion.findMany({
    where: {
      sucursalId,
      proceso: "COMPRA",
      ...(desde || hasta ? { fecha: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } } : {}),
      ...(proveedorId === SIN_PROVEEDOR ? { proveedorId: null } : proveedorId ? { proveedorId } : {}),
      ...(factura?.trim() ? { nroFactura: { contains: factura.trim(), mode: "insensitive" as const } } : {}),
    },
    include: {
      proveedor: { select: { nombre: true } },
      usuario: { select: { email: true } },
      movimientos: {
        where: { proceso: "COMPRA" },
        include: { producto: { select: { codigo: true, nombre: true, unidadStock: { select: { nombre: true } } } }, seccion: { select: { nombre: true } } },
        orderBy: { creadoEn: "asc" },
      },
    },
    orderBy: [{ fecha: "desc" }, { id: "desc" }],
    take: TAMANO_PAGINA_COMPRAS + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hayMas = operaciones.length > TAMANO_PAGINA_COMPRAS;
  const pagina = hayMas ? operaciones.slice(0, TAMANO_PAGINA_COMPRAS) : operaciones;

  const items: CompraRegistrada[] = pagina.map((o) => {
    const lineas: LineaCompra[] = o.movimientos.map((m) => ({
      idMovimiento: m.id,
      productoCodigo: m.producto.codigo,
      productoNombre: m.producto.nombre,
      cantidad: Math.abs(Number(m.cantidad)),
      unidad: m.producto.unidadStock.nombre,
      loteVencimiento: m.loteVencimiento,
      precioTotal: Number(m.precioTotal),
      precioPorUnidadStock: Number(m.precioPorUnidadStock),
      seccionNombre: m.seccion.nombre,
    }));
    return {
      idOperacion: o.id,
      fecha: o.fecha,
      proveedorId: o.proveedorId,
      proveedorNombre: o.proveedor?.nombre ?? null,
      nroFactura: o.nroFactura,
      cargadaPor: o.usuario.email,
      detalle: o.detalleLibre,
      total: redondearMoneda(lineas.reduce((suma, l) => suma + l.precioTotal, 0)),
      hayLineasSinPrecio: lineas.some((l) => !(l.precioTotal > 0)),
      lineas,
    };
  });

  return { items, nextCursor: hayMas ? pagina[pagina.length - 1].id : null };
}
