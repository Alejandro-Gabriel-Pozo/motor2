import type { ResultadoAnulacion } from "@/core/compras/anulacion";
import type { ResultadoCaso } from "@/core/resultado-caso";

/**
 * Tipos de la línea de una Compra o Devolución a proveedor, para `compra.guard.ts` (convención "guard por feature", 2026-09-25: cada
 * feature que recibe o modifica datos tiene su propio guard, que usa las funciones comunes de `src/core/datos/` en vez de
 * reemplazarlas).
 */

/** Lo que se teclea, tal cual llega — todavía sin validar. */
export interface DatosLineaCompra {
  cantidad: number | null | undefined;
  precioTotal: number | null | undefined;
  pesoReal: number | null | undefined;
}

/** Lo mismo, ya validado y listo para calcular: cantidad obligatoria (nunca `null`), precioTotal (compra sin precio → 0, sigue
 *  permitida) y pesoReal (`null` si no se cargó). */
export interface LineaCompraValidada {
  cantidad: number;
  precioTotal: number;
  pesoReal: number | null;
}

/**
 * Comando «anular una compra» (Task #41, Fase M — docs/arquitectura-casos-de-uso-2026-09-27.md): lo que recibe el caso de uso
 * `anularCompraCasoDeUso` (src/server/actions/movimientos/casos-de-uso/anular-compra.ts), YA validado por `guardComandoAnularCompra`.
 * `claveIdempotencia` es `null` cuando el cliente no mandó ninguna (rollout gradual de I3: el mecanismo queda deshabilitado).
 */
export interface ComandoAnularCompra {
  operacionId: string;
  claveIdempotencia: string | null;
}

/** Por qué `evaluarAnulacion` (src/core/compras/anulacion.ts) rechaza una anulación: la unión tal cual la declara `ResultadoAnulacion`. */
export type MotivoAnulacionRechazada = Extract<ResultadoAnulacion, { ok: false }>["motivo"];

export type CodigoAnularCompra = MotivoAnulacionRechazada | "NO_ENCONTRADA" | "CONFLICTO_IDEMPOTENCIA" | "ENTRADA_INVALIDA";

/**
 * `datos` de una anulación exitosa. Un reenvío con la misma clave (`repetida: true`) devuelve el mensaje ORIGINAL pero no vuelve a leer
 * la reversión: `reversionId` y `movimientosRevertidos` quedan en `null`.
 */
export interface DatosAnularCompra {
  compraId: string;
  reversionId: string | null;
  movimientosRevertidos: number | null;
  repetida: boolean;
}

export type ResultadoAnularCompra = ResultadoCaso<DatosAnularCompra, CodigoAnularCompra>;
