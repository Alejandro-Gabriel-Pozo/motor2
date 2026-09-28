import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature «registrar un pago a un proveedor de consignación» (Task #41, Fase M, M14 —
 * docs/arquitectura-casos-de-uso-2026-09-27.md). Antes no existía ninguna acción para esto — el "Debido por consignante"
 * (ver core/reportes/consignacion.ts) solo podía crecer — y `registrarPagoConsignante` no tenía transacción, idempotencia
 * ni auditoría: un doble clic real registraba el pago dos veces.
 */

/**
 * Comando «registrar un pago a un proveedor de consignación»: lo que recibe `registrarPagoConsignanteCasoDeUso`, YA
 * validado por `guardComandoRegistrarPagoConsignante` (proveedorId, importe normalizado por `validarImporte`, formato de
 * la clave I3). A diferencia de otros guards de esta fase, ACÁ el `importe` SÍ sale normalizado del guard (no crudo): el
 * hash I3 (`calcularPayloadHash`) se calcula DESPUÉS del guard, sobre el comando ya validado — normalizarlo antes no
 * cambia qué se hashea, y evita que el caso de uso tenga que repetir la validación.
 */
export interface ComandoRegistrarPagoConsignante {
  proveedorId: string;
  importe: number;
  fecha: Date;
  notas?: string;
  /** I3 — UUID generado por el cliente al abrir el modal de pago, reenviado tal cual en reintentos. Opcional durante el rollout. */
  claveIdempotencia?: string;
}

export type CodigoRegistrarPagoConsignante = "CONFLICTO_IDEMPOTENCIA" | "PROVEEDOR_NO_ENCONTRADO";

/** `datos` de un pago registrado con éxito. `pagoId` es `null` en el camino de idempotencia "duplicado" (no se volvió a escribir nada). */
export interface DatosRegistrarPagoConsignante {
  pagoId: string | null;
  repetido: boolean;
}

export type ResultadoRegistrarPagoConsignante = ResultadoCaso<DatosRegistrarPagoConsignante, CodigoRegistrarPagoConsignante>;
