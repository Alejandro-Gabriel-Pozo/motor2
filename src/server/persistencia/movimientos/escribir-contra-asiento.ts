import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * EL escritor del contra-asiento de una anulación (Hito 5, pieza 5.4, A5; O.13 de `docs/pureza-integracion.md`). Anular una compra o una venta no
 * edita nada: el Kardex solo agrega. Se escribe, en este orden y dentro de la transacción de quien llama:
 *  1. la `Operacion` AJUSTE nueva (el contra-asiento), con la clave de idempotencia I3 y su hash SOLO si `idempotencia` viene;
 *  2. sus líneas de Kardex (`createMany`, una por cada línea a revertir; ya calculadas por el núcleo, con el `operacionId` del paso 1 agregado acá);
 *  3. la marca `anuladaEn`/`anuladaPorId` en la `Operacion` original (la única columna de la cabecera que se toca, y la única excepción de
 *     `test/arquitectura/kardex-solo-agrega.test.ts` junto con el resultado de I3 y la corrección de una compra).
 * Antes eran dos copias casi iguales: `escribirAnulacionDeCompra` (`server/persistencia/compras/`) y `escribirAnulacionDeVenta` (acá al lado). Las dos
 * delegan y las escrituras que llegan a la base son las mismas (lo prueba la huella `test/persistencia/kardex-escritores-huella.test.ts`). Dos diferencias
 * que NO son un descuido y por eso son parámetros: la anulación de COMPRA manda siempre `claveIdempotencia` y `payloadHash` (con `null` si no hay clave)
 * y la de VENTA no manda esas claves del todo; y cada una arma sus filas como siempre (proceso y `cantidadExacta` incluidos).
 *
 * El mensaje de resultado de I3 y la fila de auditoría NO se escriben acá: los registra el caso de uso, después, en el mismo orden que antes.
 * Mismo contrato que el resto de `server/persistencia/`: `tx` obligatorio, sin reglas de negocio.
 */
export type FilaDeContraAsiento = Omit<Prisma.MovimientoStockCreateManyInput, "operacionId">;

export interface ContraAsientoAEscribir {
  /** La `Operacion` que se anula (la compra o la venta original). */
  operacionAnuladaId: string;
  sucursalId: string;
  usuarioId: string;
  /** El mismo instante para la fecha del contra-asiento y la marca `anuladaEn`. */
  ahora: Date;
  /** `detalleLibre` del contra-asiento (`detalleReversionDeCompra` / `detalleReversionDeVenta`, core/movimientos/anulaciones.ts). */
  detalleLibre: string;
  /** Solo la anulación de compra la pasa: si falta, el `create` no lleva esas dos claves (ni siquiera con `null`). */
  idempotencia?: { claveIdempotencia: string | null; payloadHash: string | null };
  /** Las líneas inversas, ya armadas por quien llama (sin `operacionId`: lo pone esta función). */
  filas: readonly FilaDeContraAsiento[];
}

export async function escribirContraAsiento(
  tx: Prisma.TransactionClient,
  contraAsiento: ContraAsientoAEscribir
): Promise<{ reversionId: string; movimientos: number }> {
  const { operacionAnuladaId, sucursalId, usuarioId, ahora, detalleLibre, idempotencia, filas } = contraAsiento;
  const reversion = await tx.operacion.create({
    data: {
      sucursalId,
      proceso: "AJUSTE",
      fecha: ahora,
      detalleLibre,
      usuarioId,
      ...(idempotencia ? { claveIdempotencia: idempotencia.claveIdempotencia, payloadHash: idempotencia.payloadHash } : {}),
    },
  });

  const filasConOperacion: Prisma.MovimientoStockCreateManyInput[] = filas.map((fila) => ({ operacionId: reversion.id, ...fila }));
  await tx.movimientoStock.createMany({ data: filasConOperacion });

  await tx.operacion.update({ where: { id: operacionAnuladaId }, data: { anuladaEn: ahora, anuladaPorId: usuarioId } });

  return { reversionId: reversion.id, movimientos: filasConOperacion.length };
}
