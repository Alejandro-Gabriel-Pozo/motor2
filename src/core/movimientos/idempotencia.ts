import { createHash } from "node:crypto";

/**
 * I3 (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md) — mecanismo
 * común de idempotencia por clave de cliente, compartido por las 5 Server
 * Actions que crean una `Operacion` dentro del alcance de la política
 * (registrarMovimiento, registrarVenta, reclasificarStock,
 * aceptarTransferencia, confirmarReingresoTransferencia — §11.5 del plan).
 * `rechazarTransferencia` NO usa este módulo: no crea `Operacion` (§6.2 del
 * plan), se resuelve aparte con una guarda de estado atómica.
 */

// §11.1: la validación del formato de la clave vive en `src/core/datos/clave-idempotencia.ts` (pura, sin `node:crypto`: la usan los
// guards de `core/features/`, Task #41 Fase M, directo de ahí — este módulo ya no la reexporta: M13d sacó a `reclasificacion.ts` (el
// último que la importaba de acá) para importarla directo, como ya hacían los demás guards).

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
 * La decisión del chequeo (§3/§7, §11.3 «fail closed»), pura: dada la fila que ya lleva la clave (o ninguna) y el hash del intento actual. Sin fila → «nueva»;
 * misma huella y resultado ya guardado → «duplicado» (se devuelve el mensaje ORIGINAL); cualquier otra cosa — otra huella, o una fila con la clave pero sin
 * `payloadHash`/`resultadoMensaje` (no debería poder ocurrir: se escriben siempre juntos) → «conflicto», nunca duplicado. Quien LEE la fila y la guarda
 * es `server/persistencia/movimientos/idempotencia.ts` (`chequearIdempotencia`, `registrarResultadoIdempotente`).
 */
export function decidirIdempotencia(existente: { payloadHash: string | null; resultadoMensaje: string | null } | null, payloadHash: string): ResultadoChequeoIdempotencia {
  if (!existente) return { estado: "nueva" };
  if (existente.payloadHash === payloadHash && existente.resultadoMensaje !== null) return { estado: "duplicado", mensaje: existente.resultadoMensaje };
  return { estado: "conflicto" };
}
