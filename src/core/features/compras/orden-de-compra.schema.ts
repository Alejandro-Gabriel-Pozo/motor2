import type { ResultadoCaso } from "@/core/resultado-caso";
import type { CodigoDeRechazoDeDatosDeOrden, CodigoDeRechazoDeOrden, CodigoDeRechazoDeVinculo, NivelDeControl } from "@/core/compras/public";

/**
 * Compras, orden de compra (etapa OC; docs/diseno-compras-n3b-n4-etapas-2026-11-16.md §«Etapa OC», corregido por el contraste con Pedernal 0066): los contratos de los comandos. Formas puras: los guards (`orden-de-compra.guard.ts`) validan el formato y
 * los casos de uso (`src/server/actions/movimientos/casos-de-uso/`) deciden con la base.
 */

export interface LineaDeOrdenInput {
  productoId: string;
  /** En la unidad de STOCK del producto. */
  cantidad: number;
  /** Por unidad de stock; `null`/ausente = «sin precio». Cero es un precio (como Pedernal). */
  precio?: number | null;
}

/** «Crear la orden»: nace BORRADOR. La sucursal destino es opcional (vacía = toda la empresa). La clave de reintento la genera la pantalla al abrirse (misma clave = la misma orden). */
export interface ComandoCrearOrdenDeCompra {
  proveedorId: string;
  sucursalId?: string | null;
  /** Día `AAAA-MM-DD` (Argentina), no anterior a hoy. */
  fechaDeEntregaPrevista?: string | null;
  lineas: LineaDeOrdenInput[];
  claveIdempotencia: string;
}

export type CodigoCrearOrdenDeCompra =
  | CodigoDeRechazoDeDatosDeOrden
  | "CONFLICTO_IDEMPOTENCIA"
  | "PROVEEDOR_NO_DISPONIBLE"
  | "SUCURSAL_NO_DISPONIBLE"
  | "PRODUCTO_NO_DISPONIBLE";

export type DatosCrearOrdenDeCompra = { repetida: boolean; ordenId: string };
export type ResultadoCrearOrdenDeCompra = ResultadoCaso<DatosCrearOrdenDeCompra, CodigoCrearOrdenDeCompra>;

/** Pedir, anular y cerrar llevan solo la orden (y el motivo al anular): son idempotentes por estado (repetir da «ya pedida», «ya anulada», «ya cerrada»). */
export interface ComandoDeOrdenDeCompra {
  ordenId: string;
}

export interface ComandoAnularOrdenDeCompra extends ComandoDeOrdenDeCompra {
  motivo: string;
}

export type CodigoPedirOrdenDeCompra = CodigoDeRechazoDeOrden;
export type DatosPedirOrdenDeCompra = { ordenId: string; numero: number };
export type ResultadoPedirOrdenDeCompra = ResultadoCaso<DatosPedirOrdenDeCompra, CodigoPedirOrdenDeCompra>;

export type CodigoAnularOrdenDeCompra = CodigoDeRechazoDeOrden;
export type ResultadoAnularOrdenDeCompra = ResultadoCaso<{ ordenId: string }, CodigoAnularOrdenDeCompra>;

export type CodigoCerrarOrdenDeCompra = CodigoDeRechazoDeOrden;
export type ResultadoCerrarOrdenDeCompra = ResultadoCaso<{ ordenId: string; cierreMotivo: "COMPLETA" | "CON_SALDO" }, CodigoCerrarOrdenDeCompra>;

/** «Configurar el control»: el nivel de `compras.recepcion_excede_la_orden` (PERMITIR | AVISAR | BLOQUEAR). Idempotente por estado: si ya está en ese nivel, no hay nada que cambiar. */
export interface ComandoConfigurarControlDeExceso {
  nivel: NivelDeControl;
}

export type CodigoConfigurarControlDeExceso = "NIVEL_INVALIDO" | "SIN_CAMBIOS";
export type ResultadoConfigurarControlDeExceso = ResultadoCaso<{ nivel: NivelDeControl }, CodigoConfigurarControlDeExceso>;

/**
 * Cargar una compra CONTRA una orden (se suma a `DatosFacturaProveedorInput`): la orden (pedida, del mismo proveedor) y, por cada renglón de la compra que se recibe contra una de sus líneas, cuál es y si se confirma el exceso
 * (necesario con el control en AVISAR cuando lo recibido supera lo pedido). Los renglones sin vínculo se reciben como siempre. `itemIndex` es la posición del ítem en `items` de la compra.
 */
export interface OrdenDeCompraDeLaCompraInput {
  ordenId: string;
  renglones: { itemIndex: number; lineaDeOrden: number; confirmoExceso?: boolean }[];
}

export type CodigoVinculoConOrden = CodigoDeRechazoDeVinculo | "ORDEN_NO_ENCONTRADA" | "ORDEN_NO_APLICA" | "RENGLON_DE_ORDEN_REPETIDO" | "LINEA_DE_ORDEN_NO_ENCONTRADA" | "MODULO_APAGADO";
