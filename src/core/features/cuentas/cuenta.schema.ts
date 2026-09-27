import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la feature Cuenta del salón (módulo POS; Task #41, Fase M — docs/arquitectura-casos-de-uso-2026-09-27.md): los comandos y
 * resultados de los casos de uso de `src/server/actions/pos/casos-de-uso/`. Mismo criterio que `core/features/ventas/venta.schema.ts`.
 * Hoy: `cerrarCuenta` (M12a). `emitirBoletaCorregida` (mismo archivo de acciones, `pos/cuenta-cierre.ts`) todavía no se migró.
 */

/**
 * Comando «cerrar la cuenta de una mesa» (M12a): lo que recibe `cerrarCuentaCasoDeUso`
 * (src/server/actions/pos/casos-de-uso/cerrar-cuenta.ts), YA validado por `guardComandoCerrarCuenta`. Sin clave de idempotencia I3:
 * `cerrarCuenta` nunca la tuvo — es idempotente POR ESTADO (una cuenta ya cerrada responde ok sin volver a vender).
 */
export interface ComandoCerrarCuenta {
  cuentaId: string;
}

/** Solo lo que produce el caso de uso: un `cuentaId` que no es un string lo rechaza antes el guard (`guardComandoCerrarCuenta`). */
export type CodigoCerrarCuenta = "NO_ENCONTRADA" | "ITEMS_SIN_ENVIAR" | "VENTA_RECHAZADA";

/**
 * Cómo terminó un cierre exitoso:
 *  - `YA_CERRADA`: la cuenta ya estaba cerrada (doble clic, o reintento de la transacción serializable) — no se escribió nada;
 *  - `SIN_VENTA`: neto cero (todo anulado) — se cerró la cuenta sin venta ni número de boleta;
 *  - `CON_VENTA`: se registró la venta (una Operacion VENTA por línea neta), se numeró la boleta y se cerró la cuenta.
 */
export type DesenlaceCierreDeCuenta = "YA_CERRADA" | "SIN_VENTA" | "CON_VENTA";

/**
 * `datos` de un cierre exitoso. `operacionIds` va en el orden de las líneas netas (vacío si no hubo venta); `numeroBoleta` es el número
 * del ejemplar A (`null` si no hubo venta); `insumosEnNegativo` cuenta los avisos de stock negativo auditados (B6bis).
 */
export interface DatosCerrarCuenta {
  desenlace: DesenlaceCierreDeCuenta;
  operacionIds: string[];
  numeroBoleta: number | null;
  insumosEnNegativo: number;
}

export type ResultadoCerrarCuenta = ResultadoCaso<DatosCerrarCuenta, CodigoCerrarCuenta>;
