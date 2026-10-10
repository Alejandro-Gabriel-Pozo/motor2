import "server-only";
import { redondearMoneda } from "@/core/moneda";
import type { Db } from "@/lib/db-tipos";
import { textoDeBusqueda } from "@/core/texto";
import { SIN_PROVEEDOR } from "@/core/reportes/public";
import { ZONA_UTC, finDelDiaDe, inicioDelDiaDe } from "@/core/tiempo/zona-horaria";
import { TAMANO_PAGINA_COMPRAS, type FiltroCompras, type RenglonCompra, type CompraRegistrada, type PaginaCompras } from "@/core/reportes/public";

/** Rango inclusivo de días en UTC (00:00:00.000 del primer día a 23:59:59.999 del último), igual que el resto de los reportes (`rangoUtc` de periodo.ts). */
const inicioDelDiaUtc = (fecha: Date): Date => inicioDelDiaDe(fecha, ZONA_UTC);
const finDelDiaUtc = (fecha: Date): Date => finDelDiaDe(fecha, ZONA_UTC);

export async function listarComprasRegistradas(sucursalId: string, filtro: FiltroCompras = {}, db: Db): Promise<PaginaCompras> {
  const { desde, hasta } = filtro;
  // Texto que viene de la URL o del cliente: sin los caracteres que Postgres no recibe (NUL, sustitutos sueltos), también los identificadores.
  const facturaBuscada = textoDeBusqueda(filtro.factura);
  const proveedorId = filtro.proveedorId ? textoDeBusqueda(filtro.proveedorId) : undefined;
  const cursor = filtro.cursor ? textoDeBusqueda(filtro.cursor) : undefined;

  const operaciones = await db.operacion.findMany({
    where: {
      sucursalId,
      proceso: "COMPRA",
      ...(desde || hasta ? { fecha: { ...(desde ? { gte: inicioDelDiaUtc(desde) } : {}), ...(hasta ? { lte: finDelDiaUtc(hasta) } : {}) } } : {}),
      ...(proveedorId === SIN_PROVEEDOR ? { proveedorId: null } : proveedorId ? { proveedorId } : {}),
      ...(facturaBuscada ? { nroFactura: { contains: facturaBuscada, mode: "insensitive" as const } } : {}),
    },
    include: {
      proveedor: { select: { nombre: true } },
      usuario: { select: { email: true } },
      anuladaPor: { select: { email: true } },
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
    const renglones: RenglonCompra[] = o.movimientos.map((m) => ({
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
      total: redondearMoneda(renglones.reduce((suma, l) => suma + l.precioTotal, 0)),
      haySinPrecio: renglones.some((l) => !(l.precioTotal > 0)),
      anuladaEn: o.anuladaEn,
      anuladaPorEmail: o.anuladaPor?.email ?? null,
      // codigo es @unique (prisma/schema.prisma) — dedupe seguro, mismo criterio de "productos distintos" que §2 (tabla-periodo.tsx).
      cantidadProductos: new Set(renglones.map((l) => l.productoCodigo)).size,
      renglones,
    };
  });

  return { items, nextCursor: hayMas ? pagina[pagina.length - 1].id : null };
}