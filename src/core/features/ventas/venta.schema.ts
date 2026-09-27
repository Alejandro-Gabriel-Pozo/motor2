import type { ResultadoAnulacionDeVenta } from "@/core/movimientos/anulaciones";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature Venta de mostrador (Task #41, Fase M — docs/arquitectura-casos-de-uso-2026-09-27.md): los comandos y resultados
 * de los casos de uso de `src/server/actions/movimientos/casos-de-uso/` (`anular-venta.ts`, `registrar-venta.ts`). Mismo criterio que
 * `core/features/compras/compra.schema.ts`.
 */

/** Una línea de la venta de mostrador, tal cual la manda la pantalla (`venta-form.tsx`). */
export interface ItemVentaInput {
  productoId: string;
  cantidadVendida: number;
}

/** Lo que recibe `registrarVenta` (src/server/actions/movimientos/venta.ts), que lo reexporta con el mismo nombre. */
export interface DatosVentaInput {
  fecha: Date;
  seccionId: string;
  proveedorId?: string; // "a quién se vende" — null/undefined = mostrador (Movimientos.js:1769, 'Mostrador' como texto libre por defecto)
  nroFactura?: string;
  detalle?: string;
  ventas: ItemVentaInput[];
  /** I3 — UUID generado por el cliente al abrir el formulario, reenviado tal cual en reintentos. Opcional durante el rollout (docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md §9.3). */
  claveIdempotencia?: string;
}

export type CodigoRegistrarVenta = "CONFLICTO_IDEMPOTENCIA" | "VENTA_RECHAZADA";

/**
 * `datos` de una venta registrada: las Operaciones VENTA creadas (una por línea, ver `registrarVentaEnTx`). Un reenvío con la misma clave
 * (`repetida: true`) devuelve el mensaje ORIGINAL sin volver a leer la venta: `operacionIds` queda en `null`.
 */
export interface DatosRegistrarVenta {
  operacionIds: string[] | null;
  repetida: boolean;
}

export type ResultadoRegistrarVenta = ResultadoCaso<DatosRegistrarVenta, CodigoRegistrarVenta>;

/**
 * Comando «anular una venta» (Task #41, Fase M): lo que recibe el caso de uso `anularVentaCasoDeUso`
 * (src/server/actions/movimientos/casos-de-uso/anular-venta.ts), YA validado por `guardComandoAnularVenta`. Sin clave de idempotencia:
 * `anularVenta` nunca tuvo I3 (una segunda anulación responde «ya está anulada»), y este refactor no la agrega.
 */
export interface ComandoAnularVenta {
  operacionId: string;
}

/** Por qué `evaluarAnulacionDeVenta` (src/core/movimientos/anulaciones.ts) rechaza una anulación: la unión tal cual la declara `ResultadoAnulacionDeVenta`. */
export type MotivoAnulacionDeVentaRechazada = Extract<ResultadoAnulacionDeVenta, { ok: false }>["motivo"];

/** Solo lo que produce el caso de uso: un `operacionId` que no es un string lo rechaza antes el guard (`guardComandoAnularVenta`). */
export type CodigoAnularVenta = MotivoAnulacionDeVentaRechazada | "NO_ENCONTRADA";

/**
 * `datos` de una anulación exitosa. `operacionesAnuladas` empieza por la venta pedida y sigue con sus hermanas de promo (misma
 * `PromoCuenta`, todavía vigentes); `reversionIds` va en el mismo orden (una Operación AJUSTE por cada una).
 */
export interface DatosAnularVenta {
  ventaId: string;
  operacionesAnuladas: string[];
  reversionIds: string[];
  movimientosRevertidos: number;
  huboLiquidacionConsignacion: boolean;
}

export type ResultadoAnularVenta = ResultadoCaso<DatosAnularVenta, CodigoAnularVenta>;
