/**
 * Pagos X0 (docs/diseno-pagos-x0-2026-11-04.md): las reglas PURAS de «declarar el pago» de una factura de proveedor. Sin base, sin Prisma, sin reloj propio (el «hoy» lo pone quien llama): el caso de uso las
 * aplica con la factura bloqueada y el oráculo `test/pagos/oraculo-declarar-pago.ts` las contrasta combinación por combinación.
 *
 * Días como texto ISO `AAAA-MM-DD` (el día de calendario argentino): se comparan como texto, que para esa forma es el orden cronológico.
 */

/** Cómo se pagó (lista cerrada; el CHECK `PagoDeFacturaProveedor_medio_chk` de la base dice lo mismo). */
export const MEDIOS_DE_PAGO = ["TRANSFERENCIA", "EFECTIVO", "CHEQUE", "TARJETA", "OTRO"] as const;
export type MedioDePago = (typeof MEDIOS_DE_PAGO)[number];

/** La condición de pago de la factura al cargarla (inmutable; el CHECK `FacturaProveedor_condicion_pago_chk` de la base dice lo mismo). */
export const CONDICIONES_DE_PAGO = ["CONTADO_PAGADA", "PENDIENTE_DE_PAGO"] as const;
export type CondicionDePago = (typeof CONDICIONES_DE_PAGO)[number];

export function esMedioDePago(valor: unknown): valor is MedioDePago {
  return typeof valor === "string" && (MEDIOS_DE_PAGO as readonly string[]).includes(valor);
}

export function esCondicionDePago(valor: unknown): valor is CondicionDePago {
  return typeof valor === "string" && (CONDICIONES_DE_PAGO as readonly string[]).includes(valor);
}

export const ETIQUETA_DE_MEDIO_DE_PAGO: Record<MedioDePago, string> = {
  TRANSFERENCIA: "Transferencia",
  EFECTIVO: "Efectivo",
  CHEQUE: "Cheque",
  TARJETA: "Tarjeta",
  OTRO: "Otro",
};

export type CodigoDeRechazoDePago = "FACTURA_ANULADA" | "NO_ADMITE_PAGO" | "YA_TIENE_PAGO" | "FECHA_FUERA_DE_RANGO";

export interface EntradaDeDeclaracionDePago {
  condicionPago: CondicionDePago;
  /** La factura está anulada. */
  anulada: boolean;
  /** Ya tiene un pago vigente (no anulado). */
  tienePagoVigente: boolean;
  /** El día de la factura (Argentina). */
  diaFactura: string;
  /** El día del pago que se declara. */
  diaPago: string;
  /** Hoy (Argentina), del reloj del servidor. */
  hoy: string;
}

export type DecisionDeDeclaracionDePago = { ok: true } | { ok: false; codigo: CodigoDeRechazoDePago; mensaje: string };

/**
 * ¿Se puede declarar ese pago sobre esa factura? Orden de las razones (la primera que corresponda): factura anulada → la factura se pagó al cargar → ya tiene un pago vigente → la fecha no es anterior al día de la
 * factura ni posterior a hoy. Puro y total: cada combinación tiene una sola respuesta.
 */
export function decidirDeclaracionDePago(e: EntradaDeDeclaracionDePago): DecisionDeDeclaracionDePago {
  if (e.anulada) return { ok: false, codigo: "FACTURA_ANULADA", mensaje: "La factura está anulada: no se le puede declarar un pago." };
  if (e.condicionPago !== "PENDIENTE_DE_PAGO") return { ok: false, codigo: "NO_ADMITE_PAGO", mensaje: "Esa factura se cargó como pagada: no admite que se declare un pago." };
  if (e.tienePagoVigente) return { ok: false, codigo: "YA_TIENE_PAGO", mensaje: "La factura ya tiene un pago declarado: anulalo primero si hay que corregirlo." };
  if (e.diaPago > e.hoy) return { ok: false, codigo: "FECHA_FUERA_DE_RANGO", mensaje: "La fecha del pago no puede ser posterior a hoy." };
  if (e.diaPago < e.diaFactura) return { ok: false, codigo: "FECHA_FUERA_DE_RANGO", mensaje: "La fecha del pago no puede ser anterior a la fecha de la factura." };
  return { ok: true };
}

/** El estado del dinero de la factura (derivado, no se guarda). */
export type EstadoDePago = "PAGADA_AL_CARGAR" | "PENDIENTE" | "PAGADA";

export function estadoDePago(condicionPago: CondicionDePago, tienePagoVigente: boolean): EstadoDePago {
  if (condicionPago === "CONTADO_PAGADA") return "PAGADA_AL_CARGAR";
  return tienePagoVigente ? "PAGADA" : "PENDIENTE";
}

/** Texto de la pantalla para el estado de pago. `pago` solo se usa cuando el estado es PAGADA. */
export function etiquetaDeEstadoDePago(estado: EstadoDePago, pago?: { dia: string; medio: MedioDePago }): string {
  if (estado === "PAGADA_AL_CARGAR") return "Pagada al cargar";
  if (estado === "PENDIENTE") return "Pendiente de pago";
  return pago ? `Pagada el ${pago.dia} (${ETIQUETA_DE_MEDIO_DE_PAGO[pago.medio]})` : "Pagada";
}
