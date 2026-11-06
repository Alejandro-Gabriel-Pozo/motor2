import type { ResultadoCaso } from "@/core/resultado-caso";
import type { ItemMovimientoInput } from "@/core/features/movimientos/movimiento.schema";
import type { CondicionDePago, MedioDePago } from "@/core/compras/public";
import type { CabeceraVista, CorreccionCompraInput } from "./compra.schema";

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
  /** Pagos X0: cómo se paga. Ausente = `CONTADO_PAGADA` (como siempre). `PENDIENTE_DE_PAGO`: el pago se declara después (`declararPagoDeFacturaProveedor`). */
  condicionPago?: CondicionDePago;
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
  | "REFERENCIA_PROVEEDOR_OBLIGATORIA"
  | "LINEA_INVALIDA"
  | "SIN_LINEAS_VALIDAS"
  | "REPARTO_INVALIDO"
  | "SUCURSAL_NO_DISPONIBLE"
  | "PRODUCTO_NO_DISPONIBLE";

/** Lo que devuelve una carga: si es un reenvío no trae nada nuevo; si no, la factura y, de la parte de la sucursal que carga (si tiene), su compra y cuántos movimientos entraron al stock. */
export type DatosRegistrarFacturaProveedor =
  | { repetida: true; facturaId: null; operacionPropiaId: null; movimientosPropios: null }
  | { repetida: false; facturaId: string; operacionPropiaId: string | null; movimientosPropios: number };

export type ResultadoRegistrarFacturaProveedor = ResultadoCaso<DatosRegistrarFacturaProveedor, CodigoRegistrarFacturaProveedor>;

/** «Aceptar mi parte»: desde la sucursal destino, con su sección y su fecha de stock (entre la fecha de la factura y hoy, en hora argentina). */
export interface ComandoAceptarParteDeFactura {
  propuestaId: string;
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
  | "SIN_LINEAS"
  | "CON_NOTAS_DE_CREDITO";

export type DatosAnularFacturaProveedor = { repetida: boolean; facturaId: string };

export type ResultadoAnularFacturaProveedor = ResultadoCaso<DatosAnularFacturaProveedor, CodigoAnularFacturaProveedor>;

/**
 * U1 de «una sola compra» — «Corregir datos de la factura» (proveedor, número, detalle): `nueva` es lo que se pide y `esperado` lo que la persona vio al abrir el formulario (guarda optimista contra pisar la corrección de otra).
 * Sin clave de reintento: es idempotente por estado (si ya tiene lo pedido, «no hay nada que corregir»).
 */
export interface ComandoCorregirFacturaProveedor {
  facturaId: string;
  nueva: CorreccionCompraInput;
  esperado: CabeceraVista;
}

export type CodigoCorregirFacturaProveedor =
  | "NO_ENCONTRADA"
  | "YA_ANULADA"
  | "SIN_PERMISO_EN_SUCURSAL"
  | "CAMBIO_CONCURRENTE"
  | "ENTRADA_INVALIDA"
  | "PROVEEDOR_INEXISTENTE"
  | "PROVEEDOR_INACTIVO"
  | "CON_NOTAS_DE_CREDITO"
  | "FACTURA_DUPLICADA";

/** Qué campos cambiaron, en el orden fijo de `diferenciasDeCabecera` (vacío si ya tenía esos datos). */
export type DatosCorregirFacturaProveedor = { facturaId: string; camposCorregidos: (keyof CabeceraVista)[] };

export type ResultadoCorregirFacturaProveedor = ResultadoCaso<DatosCorregirFacturaProveedor, CodigoCorregirFacturaProveedor>;

/** Pagos X0 «Declarar pago»: el día del pago (texto `AAAA-MM-DD`, día de Argentina) y el medio, sobre una factura `PENDIENTE_DE_PAGO`. */
export interface ComandoDeclararPagoDeFactura {
  facturaId: string;
  fechaPago: string;
  medio: MedioDePago;
  claveIdempotencia: string;
}

export type CodigoDeclararPagoDeFactura =
  | "CONFLICTO_IDEMPOTENCIA"
  | "NO_ENCONTRADA"
  | "FACTURA_ANULADA"
  | "NO_ADMITE_PAGO"
  | "YA_TIENE_PAGO"
  | "FECHA_FUERA_DE_RANGO";

export type DatosDeclararPagoDeFactura = { repetida: boolean; pagoId: string | null };

export type ResultadoDeclararPagoDeFactura = ResultadoCaso<DatosDeclararPagoDeFactura, CodigoDeclararPagoDeFactura>;

/** Pagos X0 «Anular pago declarado»: con motivo; el pago queda anulado (registro nuevo) y la factura vuelve a pendiente. */
export interface ComandoAnularPagoDeFactura {
  pagoId: string;
  motivo: string;
  claveIdempotencia: string;
}

export type CodigoAnularPagoDeFactura = "CONFLICTO_IDEMPOTENCIA" | "NO_ENCONTRADO" | "YA_ANULADO";

export type DatosAnularPagoDeFactura = { repetida: boolean };

export type ResultadoAnularPagoDeFactura = ResultadoCaso<DatosAnularPagoDeFactura, CodigoAnularPagoDeFactura>;
