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

/** Por qué `evaluarAnulacion` (src/core/compras/anulacion.ts) rechaza una anulación. Se declara ACÁ y `ResultadoAnulacion` la usa: así `core/compras` depende de su contrato (`features/compras`) y no al revés, sin ciclo. */
export type MotivoAnulacionRechazada = "NO_ES_COMPRA" | "YA_ANULADA" | "SIN_LINEAS" | "STOCK_CONSUMIDO" | "CONTEO_POSTERIOR";

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

/** Lo que se puede corregir de una compra ya confirmada: solo la cabecera (ver `src/core/compras/correccion.ts`). */
export interface CorreccionCompraInput {
  /** Vacío o null = sin proveedor. */
  proveedorId: string | null;
  nroFactura: string;
  detalleLibre: string;
}

/** Lo que la persona vio al abrir el formulario: es la guarda optimista contra pisar una corrección hecha por otra persona. */
export interface CabeceraVista {
  proveedorId: string | null;
  nroFactura: string | null;
  detalleLibre: string | null;
}

/** Comando «corregir la cabecera de una compra»: lo que recibe `corregirCompraCasoDeUso`, con el `operacionId` ya validado. */
export interface ComandoCorregirCompra {
  operacionId: string;
  nueva: CorreccionCompraInput;
  esperado: CabeceraVista;
}

export type CodigoCorregirCompra =
  | "NO_ENCONTRADA"
  | "NO_ES_COMPRA"
  | "YA_ANULADA"
  | "CAMBIO_CONCURRENTE"
  | "ENTRADA_INVALIDA"
  | "PROVEEDOR_INEXISTENTE"
  | "PROVEEDOR_INACTIVO"
  | "FACTURA_DUPLICADA";

/**
 * `datos` de una corrección exitosa: qué campos cambiaron, en el orden fijo de `diferenciasDeCabecera` (vacío si ya tenía esos datos).
 * `keyof CabeceraVista` y no `CampoCabecera` de correccion.ts: importar ese módulo acá cerraría un ciclo (correccion.ts → compra.guard.ts
 * → este archivo); las claves son las mismas tres.
 */
export interface DatosCorregirCompra {
  compraId: string;
  camposCorregidos: (keyof CabeceraVista)[];
}

export type ResultadoCorregirCompra = ResultadoCaso<DatosCorregirCompra, CodigoCorregirCompra>;
