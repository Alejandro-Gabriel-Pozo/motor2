import type { ResultadoCaso } from "@/core/resultado-caso";
import type { ItemMovimientoInput } from "@/core/features/movimientos/movimiento.schema";

/**
 * E3a (docs/diseno-factura-de-proveedor-e3a-2026-10-27.md): los contratos de los tres comandos de la factura de proveedor de mercadería repartida entre sucursales por PROPUESTA (la
 * sucursal que compra) y ACEPTACIÓN (cada sucursal destino). Formas puras: los guards (`factura-proveedor.guard.ts`) validan el formato y los casos de uso
 * (`src/server/actions/movimientos/casos-de-uso/`) deciden con la base.
 */

/** Cómo se tipeó el reparto: el importe de cada sucursal (que tiene que sumar el total) o su porcentaje (hasta dos decimales, suman 100). */
export type ModoDeRepartoInput = "IMPORTE" | "PORCENTAJE";

export interface ParteDeRepartoInput {
  sucursalId: string;
  /** Pesos (modo IMPORTE) o porcentaje (modo PORCENTAJE). */
  valor: number;
}

/** «Cargar factura»: los renglones son líneas de compra (las mismas de la pantalla de Compra, con la referencia del proveedor) y el reparto dice qué le toca a cada sucursal. */
export interface DatosFacturaProveedorInput {
  /** El mediodía argentino del día elegido: fecha de la factura y fecha de stock de la parte de la sucursal que carga. */
  fecha: Date;
  proveedorId: string;
  nroFactura?: string;
  /** Sección donde entra la parte de la sucursal que carga (obligatoria si esa sucursal tiene parte). */
  seccionId?: string;
  detalleLibre?: string;
  items: ItemMovimientoInput[];
  reparto: { modo: ModoDeRepartoInput; partes: ParteDeRepartoInput[] };
  /** I3 — UUID que genera la pantalla al abrirse; obligatoria. */
  claveIdempotencia: string;
}

export type CodigoRegistrarFacturaProveedor =
  | "CONFLICTO_IDEMPOTENCIA"
  | "PROVEEDOR_NO_DISPONIBLE"
  | "SECCION_NO_ENCONTRADA"
  | "SECCION_INACTIVA"
  | "FACTURA_INVALIDA"
  | "FACTURA_DUPLICADA"
  | "LINEA_INVALIDA"
  | "REPARTO_INVALIDO"
  | "SUCURSAL_NO_DISPONIBLE"
  | "PRODUCTO_NO_DISPONIBLE";

export type DatosRegistrarFacturaProveedor = { repetida: true; facturaId: null } | { repetida: false; facturaId: string };

export type ResultadoRegistrarFacturaProveedor = ResultadoCaso<DatosRegistrarFacturaProveedor, CodigoRegistrarFacturaProveedor>;

/** «Aceptar mi parte»: desde la sucursal destino, con su sección y su fecha de stock (entre la fecha de la factura y hoy, en hora argentina). */
export interface ComandoAceptarParteDeFactura {
  parteId: string;
  seccionId: string;
  /** El mediodía argentino del día de stock elegido. */
  fechaStock: Date;
  claveIdempotencia: string;
}

export type CodigoAceptarParteDeFactura =
  | "CONFLICTO_IDEMPOTENCIA"
  | "NO_ENCONTRADA"
  | "YA_ACEPTADA"
  | "FACTURA_ANULADA"
  | "SECCION_NO_ENCONTRADA"
  | "SECCION_INACTIVA"
  | "FECHA_FUERA_DE_RANGO"
  | "PRODUCTO_NO_DISPONIBLE"
  | "FACTURA_DUPLICADA";

export type DatosAceptarParteDeFactura = { repetida: true; operacionId: null } | { repetida: false; operacionId: string };

export type ResultadoAceptarParteDeFactura = ResultadoCaso<DatosAceptarParteDeFactura, CodigoAceptarParteDeFactura>;

/** «Anular factura» (administrador): entera y atómica, con motivo. */
export interface ComandoAnularFacturaProveedor {
  facturaId: string;
  motivo: string;
  claveIdempotencia: string;
}

export type CodigoAnularFacturaProveedor =
  | "CONFLICTO_IDEMPOTENCIA"
  | "NO_ENCONTRADA"
  | "YA_ANULADA"
  | "SIN_PERMISO_EN_SUCURSAL"
  | "STOCK_CONSUMIDO"
  | "CONTEO_POSTERIOR"
  | "NO_ES_COMPRA"
  | "SIN_LINEAS";

export type DatosAnularFacturaProveedor = { repetida: boolean; facturaId: string };

export type ResultadoAnularFacturaProveedor = ResultadoCaso<DatosAnularFacturaProveedor, CodigoAnularFacturaProveedor>;
