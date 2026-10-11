import "server-only";
import type { Db } from "@/lib/db-tipos";
import { escaparComodinesLike, textoDeBusqueda } from "@/core/texto";
import type { DatosOperacion, OperacionEncontrada } from "@/core/reportes/public";

/**
 * Port de obtenerOperacionPorId (Reportes.js:1133-1165) — a diferencia del
 * original (rescanear Historial filtrando por texto), acá es 1 query por
 * la PK real. Se acota a `sucursalId` a propósito (huella nueva respecto a
 * Apps Script, donde cada hostería ya era un spreadsheet separado — acá
 * todas comparten la misma base): nunca se debe poder traer la operación
 * de otra sucursal solo adivinando/probando un ID.
 *
 * S-14 (plan de endurecimiento de seguridad, T7): el proveedor, el N.º de factura y el email de quien anuló son los datos comerciales que «Historial de un producto» le saca
 * a quien no tiene `reporte_historial_importes` (piso administrador), y esta lectura la abre `reporte_trazabilidad` (piso operario). Se niega por defecto, en el último punto
 * donde se decide: sin `conDatosComerciales: true` la consulta ni siquiera los lee (vuelven `null`). Y dejó de traer filas enteras (`Producto`, `Proveedor`, `User`): solo lo
 * que el reporte dibuja.
 */
export async function obtenerOperacionPorId(sucursalId: string, idOperacion: string, db: Db, opciones: { conDatosComerciales?: boolean } = {}): Promise<DatosOperacion | null> {
  // Los datos comerciales entran al `select` solo para quien los puede ver: lo que no se pide a la base no puede salir por un descuido de la pantalla. (Prisma los tipa siempre
  // presentes aunque el `select` los omita; por eso abajo se leen con `?.` y `?? null`.)
  const datosComerciales = opciones.conDatosComerciales === true ? { nroFactura: true, proveedor: { select: { nombre: true } }, anuladaPor: { select: { email: true } } } : {};
  const operacion = await db.operacion.findFirst({
    where: { id: idOperacion, sucursalId },
    select: {
      id: true,
      fecha: true,
      proceso: true,
      anuladaEn: true,
      ...datosComerciales,
      movimientos: {
        select: {
          id: true,
          detalle: true,
          cantidad: true,
          loteVencimiento: true,
          proceso: true,
          producto: { select: { nombre: true, codigo: true } },
          seccion: { select: { nombre: true } },
          sustituyeAProducto: { select: { nombre: true } },
        },
      },
    },
  });
  if (!operacion) return null;

  return {
    idOperacion: operacion.id,
    fecha: operacion.fecha,
    proceso: operacion.proceso,
    proveedorNombre: operacion.proveedor?.nombre ?? null,
    nroFactura: operacion.nroFactura ?? null,
    total: operacion.movimientos.length,
    anuladaEn: operacion.anuladaEn,
    anuladaPorEmail: operacion.anuladaPor?.email ?? null,
    items: operacion.movimientos.map((m) => ({
      productoNombre: m.producto.nombre,
      productoCodigo: m.producto.codigo,
      detalle: m.detalle,
      cantidad: Number(m.cantidad),
      loteVencimiento: m.loteVencimiento,
      proceso: m.proceso,
      seccionNombre: m.seccion.nombre,
      idMovimiento: m.id,
      sustituyeANombre: m.sustituyeAProducto?.nombre ?? null,
    })),
  };
}

/** Port de buscarOperacionesPorProducto (Reportes.js:1178-1197). */
export async function buscarOperacionesPorProducto(sucursalId: string, termino: string, db: Db): Promise<OperacionEncontrada[]> {
  const q = textoDeBusqueda(termino);
  if (!q) return [];

  const movimientos = await db.movimientoStock.findMany({
    where: {
      seccion: { sucursalId },
      producto: { OR: [{ nombre: { contains: escaparComodinesLike(q), mode: "insensitive" } }, { codigo: { contains: escaparComodinesLike(q), mode: "insensitive" } }] },
    },
    select: { operacionId: true, proceso: true, seccion: { select: { nombre: true } }, operacion: { select: { fecha: true } } },
    orderBy: { operacion: { fecha: "desc" } },
    distinct: ["operacionId"],
    take: 50,
  });

  return movimientos.map((m) => ({ idOperacion: m.operacionId, fecha: m.operacion.fecha, proceso: m.proceso, seccionNombre: m.seccion.nombre }));
}