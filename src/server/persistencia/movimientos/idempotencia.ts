import "server-only";
import type { Prisma } from "@prisma/client";
import { decidirIdempotencia, type ResultadoChequeoIdempotencia } from "@/core/movimientos/public-servidor";

/**
 * I3 (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md) — la parte que LEE y ESCRIBE de la idempotencia por clave de cliente (la decisión pura y el
 * hash viven en `core/movimientos/idempotencia.ts`). Mismo nombre y misma firma que cuando vivía en `core` (Pureza Fase 4: la escritura sale de `core`).
 */

/**
 * §3/§7: se llama DENTRO de `conTransaccionSerializable`, antes de ejecutar
 * cualquier lógica de negocio. `claveIdempotencia` ausente (rollout
 * gradual, §9.3) → siempre "nueva", el mecanismo queda deshabilitado para
 * ese intento. §11.3 — "fail closed": si se encontrara una fila con la
 * clave pero sin payloadHash/resultadoMensaje (no debería poder ocurrir,
 * se escriben siempre juntos), se trata como conflicto, nunca como
 * duplicado (lo decide `decidirIdempotencia`).
 */
export async function chequearIdempotencia(
  tx: Prisma.TransactionClient,
  claveIdempotencia: string | undefined,
  payloadHash: string
): Promise<ResultadoChequeoIdempotencia> {
  if (!claveIdempotencia) return { estado: "nueva" };

  const existente = await tx.operacion.findUnique({
    where: { claveIdempotencia },
    select: { payloadHash: true, resultadoMensaje: true },
  });
  return decidirIdempotencia(existente, payloadHash);
}

/**
 * §3/§7: guarda el mensaje de resultado YA FORMATEADO en la operación que lleva la clave, para que un reenvío exacto lo devuelva tal cual
 * (`chequearIdempotencia` → "duplicado"). Se llama DENTRO de la misma transacción, al final, solo cuando hay clave. La usan los casos de uso de
 * anulación de compra, de venta y los demás que escriben una `Operacion` con clave I3.
 */
export async function registrarResultadoIdempotente(tx: Prisma.TransactionClient, operacionId: string, mensaje: string): Promise<void> {
  await tx.operacion.update({ where: { id: operacionId }, data: { resultadoMensaje: mensaje } });
}
