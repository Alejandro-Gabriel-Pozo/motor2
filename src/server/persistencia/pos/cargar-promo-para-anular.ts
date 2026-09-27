import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Lectura de la ANULACIÓN de una promo ya enviada a cocina (Task #41, Fase M12d — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo
 * contrato que `cargar-item-para-anular.ts`: `tx` OBLIGATORIO, tipos de dominio con los `Decimal` ya convertidos a `number`, sin reglas
 * de negocio). Es EXACTAMENTE la lectura que antes hacía en línea `anularPromoEnviada` (src/server/actions/pos/cuenta-anulacion.ts), con
 * el mismo filtro por sucursal. Archivo aparte de `cargar-item-para-anular.ts`: el sujeto es la promo con TODOS sus ítems, no un ítem.
 */

/** Un ítem de la promo tal como está en la cuenta: un componente original o una fila espejo que ya anuló a uno (`anulaAItemId`). */
export interface ComponenteDePromoParaAnular {
  id: string;
  cuentaId: string;
  productoId: string;
  cantidad: number;
  /** Precio de LISTA congelado al pedir: la fila espejo lo copia tal cual. */
  precioUnitario: number;
  /** Precio de CARTA congelado del componente (Task #16), `null` si no tiene: la fila espejo lo copia tal cual. */
  precioCartaUnitario: number | null;
  /** `null` = borrador sin enviar a cocina. */
  numeroEnvio: number | null;
  /** No nulo = el ítem ya es una fila espejo. */
  anulaAItemId: string | null;
  producto: { nombre: string };
  /** Las cantidades (negativas) de las filas espejo que ya lo anulan, para `restanteDe`. */
  anulaciones: { cantidad: number }[];
}

export interface PromoParaAnular {
  id: string;
  titulo: string;
  mesaNumero: number;
  cuentaCerradaEn: Date | null;
  /** TODOS los ítems con este `promoCuentaId` (originales y espejos), en el orden en que los devuelve la base — como antes. */
  items: ComponenteDePromoParaAnular[];
}

/** `null` si no hay ninguna promo con ese id en una mesa de esta sucursal (la sesión manda: nunca se carga la de otra sucursal). */
export async function cargarPromoParaAnular(tx: Prisma.TransactionClient, args: { promoCuentaId: string; sucursalId: string }): Promise<PromoParaAnular | null> {
  const promoCuenta = await tx.promoCuenta.findFirst({
    where: { id: args.promoCuentaId, cuenta: { mesa: { sucursalId: args.sucursalId } } },
    include: {
      cuenta: { include: { mesa: { select: { numero: true } } } },
      items: { include: { producto: { select: { nombre: true } }, anulaciones: { select: { cantidad: true } } } },
    },
  });
  if (!promoCuenta) return null;
  return {
    id: promoCuenta.id,
    titulo: promoCuenta.titulo,
    mesaNumero: promoCuenta.cuenta.mesa.numero,
    cuentaCerradaEn: promoCuenta.cuenta.cerradaEn,
    items: promoCuenta.items.map((item) => ({
      id: item.id,
      cuentaId: item.cuentaId,
      productoId: item.productoId,
      cantidad: Number(item.cantidad),
      precioUnitario: Number(item.precioUnitario),
      precioCartaUnitario: item.precioCartaUnitario !== null ? Number(item.precioCartaUnitario) : null,
      numeroEnvio: item.numeroEnvio,
      anulaAItemId: item.anulaAItemId,
      producto: { nombre: item.producto.nombre },
      anulaciones: item.anulaciones.map((a) => ({ cantidad: Number(a.cantidad) })),
    })),
  };
}
