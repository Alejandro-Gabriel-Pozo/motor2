import "server-only";
import type { Prisma, TipoProducto } from "@prisma/client";

/**
 * Lectura de la ANULACIÓN de un ítem ya enviado a cocina (Task #41, Fase M12c — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo
 * contrato que `cargar-cuenta-para-cerrar.ts`: `tx` OBLIGATORIO, tipos de dominio con los `Decimal` ya convertidos a `number`, sin reglas
 * de negocio). Es EXACTAMENTE la lectura que antes hacía en línea `anularItemEnviado` (src/server/actions/pos/cuenta-anulacion.ts), con
 * el mismo filtro por sucursal.
 */

export interface ItemParaAnular {
  id: string;
  cuentaId: string;
  productoId: string;
  cantidad: number;
  /** Precio de LISTA congelado al pedir: la fila espejo lo copia tal cual. */
  precioUnitario: number;
  /** Producto con descuento: el precio de lista del suelto (la fila espejo lo copia tal cual para netear con el original). */
  precioCartaUnitario: number | null;
  /** `null` = borrador sin enviar a cocina. */
  numeroEnvio: number | null;
  /** No nulo = el ítem ya es una fila espejo. */
  anulaAItemId: string | null;
  mesaNumero: number;
  cuentaCerradaEn: Date | null;
  producto: {
    nombre: string;
    tipo: TipoProducto;
    seProduce: boolean;
    /** `Producto.pasoVenta` (venta fraccionada, Task #25); `null` sin paso. */
    pasoVenta: number | null;
    /** Decimales de la unidad de stock del producto (`validarCantidadPedido`). */
    decimales: number;
  };
  /** Las cantidades (negativas) de las filas espejo que ya lo anulan, para `restanteDe`. */
  anulaciones: { cantidad: number }[];
  /** La promo de la cuenta de la que es componente (Task #16), `null` si es un suelto. */
  promoCuenta: { id: string; titulo: string } | null;
  /** GO-2b, SOLO cuando hay datos (sin opciones el ítem sale idéntico al de antes): la huella de las opciones (el espejo la repite). */
  huellaOpciones?: string;
  /** GO-2b, SOLO cuando hay datos: el ítem es un ADICIONAL de esa línea (el espejo la repite). */
  lineaPadreId?: string;
  /**
   * GO-2b: los ADICIONALES originales de esta línea (sin sus espejos), cada uno con lo que ya le anularon, su envío, su `k` (las unidades por unidad del producto,
   * de su foto) y su nombre para la auditoría. SOLO cuando hay alguno.
   */
  adicionales?: { id: string; productoId: string; productoNombre: string; cantidad: number; precioUnitario: number; numeroEnvio: number | null; k: number | null; anulaciones: { cantidad: number }[] }[];
}

/** `null` si no hay ningún ítem con ese id en una mesa de esta sucursal (la sesión manda: nunca se carga el de otra sucursal). */
export async function cargarItemParaAnular(tx: Prisma.TransactionClient, args: { cuentaItemId: string; sucursalId: string }): Promise<ItemParaAnular | null> {
  const item = await tx.cuentaItem.findFirst({
    where: { id: args.cuentaItemId, cuenta: { mesa: { sucursalId: args.sucursalId } } },
    include: {
      producto: { select: { tipo: true, nombre: true, pasoVenta: true, seProduce: true, unidadStock: { select: { decimales: true } } } },
      cuenta: { include: { mesa: { select: { numero: true } } } },
      anulaciones: { select: { cantidad: true } },
      promoCuenta: { select: { id: true, titulo: true } },
      // GO-2b: los adicionales de la línea (y sus espejos, para saber cuánto les queda), con la `k` de su foto, en la MISMA consulta (sin opciones, vacío).
      adicionales: {
        where: { anulaAItemId: null },
        orderBy: [{ creadoEn: "asc" }, { id: "asc" }],
        select: {
          id: true,
          productoId: true,
          cantidad: true,
          precioUnitario: true,
          numeroEnvio: true,
          producto: { select: { nombre: true } },
          anulaciones: { select: { cantidad: true } },
          opcionesElegidas: { where: { tipoGrupo: "ADICIONAL" }, select: { cantidad: true } },
        },
      },
    },
  });
  if (!item) return null;
  return {
    id: item.id,
    cuentaId: item.cuentaId,
    productoId: item.productoId,
    cantidad: Number(item.cantidad),
    precioUnitario: Number(item.precioUnitario),
    precioCartaUnitario: item.precioCartaUnitario !== null ? Number(item.precioCartaUnitario) : null,
    numeroEnvio: item.numeroEnvio,
    anulaAItemId: item.anulaAItemId,
    mesaNumero: item.cuenta.mesa.numero,
    cuentaCerradaEn: item.cuenta.cerradaEn,
    producto: {
      nombre: item.producto.nombre,
      tipo: item.producto.tipo,
      seProduce: item.producto.seProduce,
      pasoVenta: item.producto.pasoVenta !== null ? Number(item.producto.pasoVenta) : null,
      decimales: item.producto.unidadStock.decimales,
    },
    anulaciones: item.anulaciones.map((a) => ({ cantidad: Number(a.cantidad) })),
    promoCuenta: item.promoCuenta,
    ...(item.huellaOpciones !== null ? { huellaOpciones: item.huellaOpciones } : {}),
    ...(item.lineaPadreId !== null ? { lineaPadreId: item.lineaPadreId } : {}),
    ...(item.adicionales.length > 0 ? { adicionales: adicionalesDe(item.adicionales) } : {}),
  };
}

function adicionalesDe(
  adicionales: readonly { id: string; productoId: string; cantidad: Prisma.Decimal; precioUnitario: Prisma.Decimal; numeroEnvio: number | null; producto: { nombre: string }; anulaciones: { cantidad: Prisma.Decimal }[]; opcionesElegidas: { cantidad: number }[] }[]
): NonNullable<ItemParaAnular["adicionales"]> {
  return adicionales.map((a) => ({
      id: a.id,
      productoId: a.productoId,
      productoNombre: a.producto.nombre,
      cantidad: Number(a.cantidad),
      precioUnitario: Number(a.precioUnitario),
      numeroEnvio: a.numeroEnvio,
      k: a.opcionesElegidas[0]?.cantidad ?? null,
      anulaciones: a.anulaciones.map((e) => ({ cantidad: Number(e.cantidad) })),
    }));
}
