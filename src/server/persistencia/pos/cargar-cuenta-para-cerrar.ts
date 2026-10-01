import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Lecturas del CIERRE de una cuenta del salón (Task #41, Fase M12a — docs/arquitectura-casos-de-uso-2026-09-27.md; mismo contrato que
 * `server/persistencia/movimientos/cargar-venta-para-anular.ts`: `tx` OBLIGATORIO, tipos de dominio con los `Decimal` ya convertidos a
 * `number`, sin reglas de negocio). Son EXACTAMENTE las lecturas que antes hacía en línea `cerrarCuenta`
 * (src/server/actions/pos/cuenta-cierre.ts), con los mismos filtros, y el caso de uso las llama en el mismo orden.
 */

/** Un ítem de la cuenta tal como lo necesita el cierre. */
export interface ItemParaCerrar {
  productoId: string;
  cantidad: number;
  /** Precio de LISTA congelado al pedir (nunca cambia de semántica con el descuento de cliente, Task #14). */
  precioUnitario: number;
  /** Producto con descuento: el precio de lista antes de ese descuento (`CuentaItem.precioCartaUnitario`); en un componente de promo, el precio de carta. */
  precioCartaUnitario: number | null;
  promoCuentaId: string | null;
  /** `null` = borrador sin enviar a cocina. */
  numeroEnvio: number | null;
}

export interface CuentaParaCerrar {
  id: string;
  mesaNumero: number;
  cerradaEn: Date | null;
  clienteId: string | null;
  clienteNombre: string | null;
  /** SNAPSHOT del % del cliente al asignarlo (D7), `null` sin cliente. */
  descuentoPorcentaje: number | null;
  items: ItemParaCerrar[];
}

/** `null` si no hay ninguna cuenta con ese id en una mesa de esta sucursal (la sesión manda: nunca se carga la de otra sucursal). */
export async function cargarCuentaParaCerrar(tx: Prisma.TransactionClient, args: { cuentaId: string; sucursalId: string }): Promise<CuentaParaCerrar | null> {
  const cuenta = await tx.cuenta.findFirst({
    where: { id: args.cuentaId, mesa: { sucursalId: args.sucursalId } },
    include: { mesa: { select: { numero: true } }, items: true, cliente: { select: { nombre: true } } },
  });
  if (!cuenta) return null;
  return {
    id: cuenta.id,
    mesaNumero: cuenta.mesa.numero,
    cerradaEn: cuenta.cerradaEn,
    clienteId: cuenta.clienteId,
    clienteNombre: cuenta.cliente?.nombre ?? null,
    descuentoPorcentaje: cuenta.descuentoPorcentaje !== null ? Number(cuenta.descuentoPorcentaje) : null,
    items: cuenta.items.map((i) => ({
      productoId: i.productoId,
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precioUnitario),
      precioCartaUnitario: i.precioCartaUnitario !== null ? Number(i.precioCartaUnitario) : null,
      promoCuentaId: i.promoCuentaId,
      numeroEnvio: i.numeroEnvio,
    })),
  };
}

/**
 * El número de boleta más alto ya emitido en la sucursal (`null` si todavía no hay ninguno). El siguiente lo calcula
 * `siguienteNumeroBoleta` (core/pos/numeracion-boleta.ts) — docs/plan-numeracion-boleta-2026-09-25.md, D2: `max + 1` dentro de la
 * transacción serializable, sin tabla contador ni SEQUENCE.
 */
export async function cargarUltimoNumeroDeBoleta(tx: Prisma.TransactionClient, sucursalId: string): Promise<number | null> {
  const { _max } = await tx.ejemplarBoleta.aggregate({ where: { sucursalId }, _max: { numero: true } });
  return _max.numero;
}

/**
 * La Operacion de la venta que consumió ese insumo en ESA sección (la primera, por `creadoEn`): a ella se enlaza la fila de auditoría de
 * stock negativo (B6bis). `null` si no aparece — el caso de uso cae entonces a la primera Operacion de la venta, como antes.
 */
export async function cargarOperacionDelConsumo(
  tx: Prisma.TransactionClient,
  args: { operacionIds: readonly string[]; productoId: string; seccionId: string }
): Promise<string | null> {
  const consumo = await tx.movimientoStock.findFirst({
    where: { operacionId: { in: [...args.operacionIds] }, productoId: args.productoId, seccionId: args.seccionId, proceso: "CONSUMO" },
    select: { operacionId: true },
    orderBy: { creadoEn: "asc" },
  });
  return consumo?.operacionId ?? null;
}
