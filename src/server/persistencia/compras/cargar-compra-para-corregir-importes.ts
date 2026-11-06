import "server-only";
import type { Prisma } from "@prisma/client";
import type { RenglonVigente } from "@/core/compras/public";

/**
 * Carga de una compra para CORREGIR SUS IMPORTES por ejemplar (etapa C0, docs/diseno-correccion-de-compras-2026-11-06.md). Mismo contrato que el resto de `server/persistencia/`: `tx` OBLIGATORIO como primer parámetro (corre dentro
 * de la transacción SERIALIZABLE del caso de uso), devuelve TIPOS DE DOMINIO (los `Decimal` pasan a `number` acá) y NO decide nada: qué hacer con lo cargado lo deciden `evaluarCorreccionDeImportes` y el caso de uso.
 */
export interface CompraParaCorregirImportes {
  id: string;
  proceso: string;
  anuladaEn: Date | null;
  fecha: Date;
  nroFactura: string | null;
  proveedorId: string | null;
  detalleLibre: string | null;
  /** La compra que ya reemplazó a esta (si la hay): esta versión ya no es la vigente. */
  reemplazadaPorId: string | null;
  /** E3a (D8): alguna línea sale de un renglón de factura de proveedor: es la parte de una factura y no se corrige suelta. */
  esDeFactura: boolean;
  lineas: (RenglonVigente & { precioPorUnidadStock: number; seccionNombre: string })[];
}

/** `null` si no hay ninguna operación con ese id en esta sucursal (la sesión manda: nunca se carga la de otra sucursal). */
export async function cargarCompraParaCorregirImportes(tx: Prisma.TransactionClient, args: { operacionId: string; sucursalId: string }): Promise<CompraParaCorregirImportes | null> {
  const o = await tx.operacion.findFirst({
    where: { id: args.operacionId, sucursalId: args.sucursalId },
    include: {
      reemplazadaPor: { select: { id: true } },
      movimientos: {
        orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
        include: { producto: { select: { nombre: true } }, seccion: { select: { nombre: true } } },
      },
    },
  });
  if (!o) return null;
  const compras = o.movimientos.filter((m) => m.proceso === "COMPRA");
  return {
    id: o.id,
    proceso: o.proceso,
    anuladaEn: o.anuladaEn,
    fecha: o.fecha,
    nroFactura: o.nroFactura,
    proveedorId: o.proveedorId,
    detalleLibre: o.detalleLibre,
    reemplazadaPorId: o.reemplazadaPor?.id ?? null,
    esDeFactura: compras.some((m) => m.facturaProveedorRenglonId !== null),
    lineas: compras.map((m) => ({
      movimientoId: m.id,
      productoId: m.productoId,
      productoNombre: m.producto.nombre,
      seccionId: m.seccionId,
      seccionNombre: m.seccion.nombre,
      loteVencimiento: m.loteVencimiento,
      cantidad: Number(m.cantidad),
      detalle: m.detalle,
      precioTotal: Number(m.precioTotal),
      precioPorUnidadStock: Number(m.precioPorUnidadStock),
    })),
  };
}
