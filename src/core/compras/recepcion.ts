/**
 * Compras, recepción separada (etapa N3-a; docs/diseno-compras-paridad-escalera-2026-11-16.md, niveles 4 y 5; oráculo `docs/oraculo-combinaciones-compras-recepcion-2026-11-16.md`): las reglas PURAS de cuándo una parte de factura
 * nace pendiente de recibir y de cuándo se puede confirmar su recepción. Sin base, sin Prisma, sin reloj propio (el «hoy» y los días los pone quien llama): el caso de uso las aplica con la cabecera de la factura bloqueada y el oráculo
 * las contrasta combinación por combinación.
 *
 * Días como texto ISO `AAAA-MM-DD` (el día de calendario argentino): se comparan como texto, que para esa forma es el orden cronológico.
 */

/** Los dos estados de recepción de una parte (el CHECK `FacturaProveedorSucursal_estado_recepcion_chk` de la base dice lo mismo). Una parte PENDIENTE pasa a RECIBIDA una sola vez y no vuelve atrás (lo impone un disparador). */
export const ESTADOS_DE_RECEPCION = ["PENDIENTE", "RECIBIDA"] as const;
export type EstadoDeRecepcion = (typeof ESTADOS_DE_RECEPCION)[number];

/**
 * ¿Con qué estado nace la parte de la sucursal que carga la factura? PENDIENTE (sin compra ni stock: la confirmación los crea) solo si el módulo `recepcion_de_compras` está encendido en la empresa Y la factura es de UNA sola parte
 * (la de quien carga, sin partes de otras sucursales). Una factura repartida sigue como siempre (la parte propia entra al stock al cargar; la de cada destino, al aceptarla): la recepción separada de las repartidas es una etapa posterior.
 */
export function estadoInicialDeLaParte(e: { moduloEncendido: boolean; hayPartesAjenas: boolean }): EstadoDeRecepcion {
  return e.moduloEncendido && !e.hayPartesAjenas ? "PENDIENTE" : "RECIBIDA";
}

/** De quién es la sección elegida para recibir: de la sucursal que recibe y activa, de otra sucursal (o inexistente: para quien pregunta es lo mismo), o de la sucursal pero dada de baja. */
export type SeccionParaRecibir = "PROPIA_ACTIVA" | "AJENA" | "INACTIVA";

export type CodigoDeRechazoDeRecepcion = "NO_ES_DE_ESTA_SUCURSAL" | "YA_ANULADA" | "YA_RECIBIDA" | "SECCION_NO_ENCONTRADA" | "SECCION_INACTIVA" | "FECHA_FUERA_DE_RANGO";
export type DecisionDeConfirmacionDeRecepcion = { ok: true } | { ok: false; codigo: CodigoDeRechazoDeRecepcion; mensaje: string };

export interface EntradaDeConfirmacionDeRecepcion {
  /** La parte pertenece a la sucursal activa de quien confirma. */
  esDeLaSucursalDelActor: boolean;
  /** La factura está anulada. */
  facturaAnulada: boolean;
  estadoDeLaParte: EstadoDeRecepcion;
  seccion: SeccionParaRecibir;
  /** El día de la factura (Argentina). */
  diaFactura: string;
  /** El día de stock que se elige. */
  diaStock: string;
  /** Hoy (Argentina), del reloj del servidor. */
  hoy: string;
}

export const MENSAJE_RECEPCION_NO_ENCONTRADA = "No se encontró esa compra para recibir en esta sucursal.";
export const MENSAJE_RECEPCION_YA_RECIBIDA = "Esta compra ya fue recibida: no se cargó stock de nuevo.";

/** El texto de la fecha de stock fuera de rango (lo usan la regla y quien la quiera mostrar): entre la fecha de la factura y hoy. */
export function mensajeFechaDeStockFueraDeRango(diaFactura: string, hoy: string): string {
  return `La fecha de stock tiene que estar entre la fecha de la factura (${diaFactura}) y hoy (${hoy}).`;
}

/**
 * ¿Se puede confirmar la recepción de esa parte? Orden de las razones (la primera que corresponda): la parte no es de esta sucursal (no se dice nada más: no se filtra la existencia) → la factura está anulada → la parte ya está recibida →
 * la sección no es de esta sucursal (o no existe) → la sección está dada de baja → la fecha de stock no está entre la fecha de la factura y hoy. Puro y total: cada combinación tiene una sola respuesta.
 */
export function decidirConfirmacionDeRecepcion(e: EntradaDeConfirmacionDeRecepcion): DecisionDeConfirmacionDeRecepcion {
  if (!e.esDeLaSucursalDelActor) return { ok: false, codigo: "NO_ES_DE_ESTA_SUCURSAL", mensaje: MENSAJE_RECEPCION_NO_ENCONTRADA };
  if (e.facturaAnulada) return { ok: false, codigo: "YA_ANULADA", mensaje: "La factura fue anulada: esta compra ya no se puede recibir." };
  if (e.estadoDeLaParte !== "PENDIENTE") return { ok: false, codigo: "YA_RECIBIDA", mensaje: MENSAJE_RECEPCION_YA_RECIBIDA };
  if (e.seccion === "AJENA") return { ok: false, codigo: "SECCION_NO_ENCONTRADA", mensaje: "No se encontró la sección." };
  if (e.seccion === "INACTIVA") return { ok: false, codigo: "SECCION_INACTIVA", mensaje: "Esa sección está desactivada: elegí otra para recibir la mercadería." };
  if (e.diaStock < e.diaFactura || e.diaStock > e.hoy) return { ok: false, codigo: "FECHA_FUERA_DE_RANGO", mensaje: mensajeFechaDeStockFueraDeRango(e.diaFactura, e.hoy) };
  return { ok: true };
}
