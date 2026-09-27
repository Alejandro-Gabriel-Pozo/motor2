import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

/**
 * I3 (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md) — mecanismo
 * común de idempotencia por clave de cliente, compartido por las 5 Server
 * Actions que crean una `Operacion` dentro del alcance de la política
 * (registrarMovimiento, registrarVenta, reclasificarStock,
 * aceptarTransferencia, confirmarReingresoTransferencia — §11.5 del plan).
 * `rechazarTransferencia` NO usa este módulo: no crea `Operacion` (§6.2 del
 * plan), se resuelve aparte con una guarda de estado atómica.
 */

/**
 * §11.1: la validación del formato de la clave vive en `src/core/datos/clave-idempotencia.ts` (pura, sin `node:crypto`: la usan los guards
 * de `core/features/`, Task #41 Fase M). Se reexporta acá para los que ya la importaban de este módulo.
 */
export { esClaveIdempotenciaValida } from "@/core/datos/clave-idempotencia";

function canonicalizar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonicalizar);
  if (valor instanceof Date) return valor.toISOString();
  if (valor && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, canonicalizar(v)] as const);
    return Object.fromEntries(entradas);
  }
  return valor ?? null;
}

/**
 * §11.2: SHA-256 del payload YA VALIDADO (nunca el body crudo), con claves
 * ordenadas recursivamente para no depender del orden de serialización del
 * cliente. Incluye `sucursalId` (un reenvío de la misma clave desde otra
 * sucursal es un payload distinto, no un duplicado legítimo) y `procesoTag`
 * — un identificador explícito del proceso/Server Action, agregado a
 * propósito (no dejado como coincidencia de la forma del payload) para que
 * la misma clave reutilizada entre procesos distintos SIEMPRE dé conflicto
 * (§11.8), nunca un duplicado silencioso ni una operación libre.
 */
export function calcularPayloadHash(procesoTag: string, sucursalId: string, payload: unknown): string {
  const canon = canonicalizar({ procesoTag, sucursalId, payload });
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

export const MENSAJE_CONFLICTO_IDEMPOTENCIA = "Esta operación ya se había enviado con datos distintos — recargá la página e intentalo de nuevo.";

export type ResultadoChequeoIdempotencia =
  | { estado: "nueva" }
  | { estado: "duplicado"; mensaje: string }
  | { estado: "conflicto" };

/**
 * §3/§7: se llama DENTRO de `conTransaccionSerializable`, antes de ejecutar
 * cualquier lógica de negocio. `claveIdempotencia` ausente (rollout
 * gradual, §9.3) → siempre "nueva", el mecanismo queda deshabilitado para
 * ese intento. §11.3 — "fail closed": si se encontrara una fila con la
 * clave pero sin payloadHash/resultadoMensaje (no debería poder ocurrir,
 * se escriben siempre juntos), se trata como conflicto, nunca como
 * duplicado.
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
  if (!existente) return { estado: "nueva" };

  if (existente.payloadHash === payloadHash && existente.resultadoMensaje !== null) {
    return { estado: "duplicado", mensaje: existente.resultadoMensaje };
  }
  return { estado: "conflicto" };
}

/**
 * §3/§7: guarda el mensaje de resultado YA FORMATEADO en la operación que lleva la clave, para que un reenvío exacto lo devuelva tal cual
 * (`chequearIdempotencia` → "duplicado"). Se llama DENTRO de la misma transacción, al final, solo cuando hay clave. Primer uso: el caso de
 * uso `anularCompra` (Task #41, Fase M); las demás acciones I3 siguen escribiendo `resultadoMensaje` en línea hasta migrar.
 */
export async function registrarResultadoIdempotente(tx: Prisma.TransactionClient, operacionId: string, mensaje: string): Promise<void> {
  await tx.operacion.update({ where: { id: operacionId }, data: { resultadoMensaje: mensaje } });
}
