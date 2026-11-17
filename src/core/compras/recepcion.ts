import { Decimal } from "decimal.js";
import { textoDeUnaLineaDesdeTexto } from "@/core/datos/texto-de-catalogo";

/**
 * Compras, recepción separada (etapa N3-a; docs/diseno-compras-paridad-escalera-2026-11-16.md, niveles 4 y 5; oráculo `docs/oraculo-combinaciones-compras-recepcion-2026-11-16.md`): las reglas PURAS de cuándo una parte de factura
 * nace pendiente de recibir y de cuándo se puede confirmar su recepción. Sin base, sin Prisma y sin reloj: el caso de uso las aplica con la cabecera de la factura bloqueada y el oráculo las contrasta combinación por combinación.
 * La fecha del stock no es una decisión de la regla ni de quien confirma: es la de la confirmación (paridad con Pedernal, `hechoEn: contexto.ahora`), y la pone el caso de uso.
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

export type CodigoDeRechazoDeRecepcion = "NO_ES_DE_ESTA_SUCURSAL" | "YA_ANULADA" | "SECCION_NO_ENCONTRADA" | "SECCION_INACTIVA";
/**
 * La sección dada de baja no lleva mensaje propio: el texto único `mensajeSeccionDesactivada` necesita el nombre de la sección y lo pone el caso de uso.
 * `ok` con `yaRecibida: true` es la REPETICIÓN (paridad con Pedernal, `yaExistia`): la parte ya estaba recibida y no hay nada que escribir; con `false`, se puede confirmar.
 */
export type DecisionDeConfirmacionDeRecepcion =
  | { ok: true; yaRecibida: boolean }
  | { ok: false; codigo: Exclude<CodigoDeRechazoDeRecepcion, "SECCION_INACTIVA">; mensaje: string }
  | { ok: false; codigo: "SECCION_INACTIVA" };

export interface EntradaDeConfirmacionDeRecepcion {
  /** La parte pertenece a la sucursal activa de quien confirma. */
  esDeLaSucursalDelActor: boolean;
  /** La factura está anulada. */
  facturaAnulada: boolean;
  estadoDeLaParte: EstadoDeRecepcion;
  seccion: SeccionParaRecibir;
}

export const MENSAJE_RECEPCION_NO_ENCONTRADA = "No se encontró esa compra para recibir en esta sucursal.";
export const MENSAJE_RECEPCION_YA_RECIBIDA = "Esta compra ya fue recibida: no se cargó stock de nuevo.";

/** El texto de la fecha de stock fuera de rango (lo usa «aceptar mi parte», donde sí se elige el día): entre la fecha de la factura y hoy. */
export function mensajeFechaDeStockFueraDeRango(diaFactura: string, hoy: string): string {
  return `La fecha de stock tiene que estar entre la fecha de la factura (${diaFactura}) y hoy (${hoy}).`;
}

/**
 * ¿Se puede confirmar la recepción de esa parte? Orden de las razones (la primera que corresponda): la parte no es de esta sucursal (no se dice nada más: no se filtra la existencia) → la factura está anulada → la parte ya está recibida
 * (ÉXITO con `yaRecibida: true`: repetir confirmar no mueve nada y no mira la sección) → la sección no es de esta sucursal (o no existe) → la sección está dada de baja. Puro y total: cada combinación tiene una sola respuesta.
 */
export function decidirConfirmacionDeRecepcion(e: EntradaDeConfirmacionDeRecepcion): DecisionDeConfirmacionDeRecepcion {
  if (!e.esDeLaSucursalDelActor) return { ok: false, codigo: "NO_ES_DE_ESTA_SUCURSAL", mensaje: MENSAJE_RECEPCION_NO_ENCONTRADA };
  if (e.facturaAnulada) return { ok: false, codigo: "YA_ANULADA", mensaje: "La factura fue anulada: esta compra ya no se puede recibir." };
  if (e.estadoDeLaParte !== "PENDIENTE") return { ok: true, yaRecibida: true };
  if (e.seccion === "AJENA") return { ok: false, codigo: "SECCION_NO_ENCONTRADA", mensaje: "No se encontró la sección." };
  if (e.seccion === "INACTIVA") return { ok: false, codigo: "SECCION_INACTIVA" };
  return { ok: true, yaRecibida: false };
}

// ================================================================================================
// Compras, recepción separada N3-b: el control por línea y las entradas de stock por sección
// (docs/diseno-compras-n3b-n4-etapas-2026-11-16.md, §«Etapa N3-b»; referencia de forma: Pedernal `0063_compras_recepcion_separada.sql`, tablas `inspeccion_de_linea_de_recepcion` y `entrada_de_linea_de_recepcion`).
// ================================================================================================

/** Cómo llegó la mercadería de una línea. SIN control = «no se constató»: nunca hay un CONFORME por defecto. El CHECK `ControlDeLineaDeRecepcion_condicion_chk` de la base dice lo mismo. */
export const CONDICIONES_DE_CONTROL = ["CONFORME", "CON_OBSERVACIONES", "RECHAZADA"] as const;
export type CondicionDeControl = (typeof CONDICIONES_DE_CONTROL)[number];

/** Tope de la observación (el CHECK de la base dice lo mismo). */
export const LARGO_MAXIMO_DE_LA_OBSERVACION = 500;
/** Tope de la cantidad según remito: la columna es `Decimal(14,4)` y el CHECK de la base pide menos de 1e11; acá se pide menos de 1e10, como el resto de las cantidades. */
const CANTIDAD_MAXIMA_SEGUN_REMITO = 1e10;
/** Decimales de las cantidades (`Decimal(14,4)`): el paso entero de una cantidad es 10^-4. */
const DECIMALES_DE_CANTIDAD = 4;

export const ETIQUETA_DE_CONDICION_DE_CONTROL: Readonly<Record<CondicionDeControl, string>> = {
  CONFORME: "Conforme",
  CON_OBSERVACIONES: "Con observaciones",
  RECHAZADA: "Rechazada",
};

function esCondicionDeControl(valor: unknown): valor is CondicionDeControl {
  return typeof valor === "string" && (CONDICIONES_DE_CONTROL as readonly string[]).includes(valor);
}

export type CodigoDeRechazoDeControl = "CONDICION_INVALIDA" | "OBSERVACION_OBLIGATORIA" | "OBSERVACION_INVALIDA" | "CANTIDAD_SEGUN_REMITO_INVALIDA";

interface ControlDeLineaValidado {
  condicion: CondicionDeControl;
  /** Recortada y con los espacios repetidos colapsados (la forma canónica del texto de una línea); `null` si no se escribió. */
  observacion: string | null;
  /** `null` si no se informó. */
  cantidadSegunRemito: number | null;
}

type ResultadoDeControlDeLinea = { ok: true; valor: ControlDeLineaValidado } | { ok: false; codigo: CodigoDeRechazoDeControl; mensaje: string };

const MENSAJE_CONDICION_DE_CONTROL_INVALIDA = "Elegí cómo llegó la mercadería: conforme, con observaciones o rechazada.";
const MENSAJE_OBSERVACION_OBLIGATORIA = "Escribí la observación: es obligatoria si la mercadería no está conforme.";
const MENSAJE_OBSERVACION_INVALIDA = `La observación tiene caracteres que no se admiten o pasa de ${LARGO_MAXIMO_DE_LA_OBSERVACION} caracteres.`;
const MENSAJE_CANTIDAD_SEGUN_REMITO_INVALIDA = "La cantidad según el remito tiene que ser un número mayor que cero, con hasta 4 decimales.";

/**
 * ¿Sirve el control de UNA línea? Orden de las razones: condición fuera de la lista → observación escrita que no pasa la lista de caracteres PERMITIDOS (la del texto de catálogo, con `¿ ¡ ? ! % $`; una sola línea, hasta 500) →
 * observación faltante si no es CONFORME → cantidad según remito informada que no es un número mayor que cero con hasta 4 decimales. Una observación vacía o de solo espacios cuenta como no escrita. Con CONFORME la observación es
 * opcional (como en Pedernal). Puro y total: cada combinación tiene una sola respuesta.
 */
export function validarControlDeLinea(c: { condicion: unknown; observacion?: unknown; cantidadSegunRemito?: unknown }): ResultadoDeControlDeLinea {
  if (!esCondicionDeControl(c.condicion)) return { ok: false, codigo: "CONDICION_INVALIDA", mensaje: MENSAJE_CONDICION_DE_CONTROL_INVALIDA };
  let observacion: string | null = null;
  if (c.observacion !== undefined && c.observacion !== null) {
    if (typeof c.observacion !== "string") return { ok: false, codigo: "OBSERVACION_INVALIDA", mensaje: MENSAJE_OBSERVACION_INVALIDA };
    if (c.observacion.trim() !== "") {
      const t = textoDeUnaLineaDesdeTexto(c.observacion, { maximo: LARGO_MAXIMO_DE_LA_OBSERVACION, exigirUnaLetra: false, conSignosDeCatalogo: true });
      if (!t.ok) return { ok: false, codigo: "OBSERVACION_INVALIDA", mensaje: MENSAJE_OBSERVACION_INVALIDA };
      observacion = t.valor;
    }
  }
  if (c.condicion !== "CONFORME" && observacion === null) return { ok: false, codigo: "OBSERVACION_OBLIGATORIA", mensaje: MENSAJE_OBSERVACION_OBLIGATORIA };
  let cantidadSegunRemito: number | null = null;
  if (c.cantidadSegunRemito !== undefined && c.cantidadSegunRemito !== null) {
    const n = c.cantidadSegunRemito;
    const bien = typeof n === "number" && Number.isFinite(n) && n > 0 && n < CANTIDAD_MAXIMA_SEGUN_REMITO && pasosEnteros(n) !== null;
    if (!bien) return { ok: false, codigo: "CANTIDAD_SEGUN_REMITO_INVALIDA", mensaje: MENSAJE_CANTIDAD_SEGUN_REMITO_INVALIDA };
    cantidadSegunRemito = n;
  }
  return { ok: true, valor: { condicion: c.condicion, observacion, cantidadSegunRemito } };
}

/** La cantidad en PASOS ENTEROS de 10^-4 (la precisión de las columnas de cantidad), o `null` si no es un múltiplo exacto de ese paso (más de 4 decimales). Sin flotantes: pasa por `Decimal`. */
function pasosEnteros(cantidad: number): number | null {
  const pasos = new Decimal(cantidad).times(new Decimal(10).pow(DECIMALES_DE_CANTIDAD));
  return pasos.isInteger() ? pasos.toNumber() : null;
}

export interface EntradaDeRecepcion {
  renglonId: string;
  seccionId: string;
}

export type CodigoDeRechazoDeEntradas = "SIN_ENTRADAS" | "RENGLON_AJENO" | "ENTRADA_REPETIDA" | "RENGLON_SIN_ENTRADAS";

type ResultadoDeEntradas = { ok: true } | { ok: false; codigo: CodigoDeRechazoDeEntradas; mensaje: string };

const MENSAJE_SIN_ENTRADAS = "Indicá la sección donde entra cada renglón de la compra.";
const MENSAJE_RENGLON_AJENO = "No se encontró uno de los renglones en esta compra.";
const MENSAJE_ENTRADA_REPETIDA = "Cada renglón entra entero en una sola sección.";
const MENSAJE_RENGLON_SIN_ENTRADAS = "Falta indicar la sección donde entra uno de los renglones de la compra.";

/**
 * ¿Sirven los destinos de la recepción? Cada entrada es `{ renglón, sección }`: UN solo destino por renglón, que recibe la cantidad TOTAL del renglón (paridad con Pedernal: una sola asignación por línea; no se divide un renglón entre
 * secciones). Reglas, en este orden: hay al menos una entrada → cada renglón es de la compra → ningún renglón aparece dos veces → todo renglón de mercadería de la compra tiene su destino. Que cada sección sea propia de la sucursal y
 * esté activa lo mira `decidirConfirmacionDeRecepcion` con lo que lee el caso de uso.
 */
export function validarEntradasDeRecepcion(renglonIds: readonly string[], entradas: readonly EntradaDeRecepcion[]): ResultadoDeEntradas {
  if (entradas.length === 0) return { ok: false, codigo: "SIN_ENTRADAS", mensaje: MENSAJE_SIN_ENTRADAS };
  const delaCompra = new Set(renglonIds);
  const vistos = new Set<string>();
  for (const e of entradas) {
    if (!delaCompra.has(e.renglonId)) return { ok: false, codigo: "RENGLON_AJENO", mensaje: MENSAJE_RENGLON_AJENO };
    if (vistos.has(e.renglonId)) return { ok: false, codigo: "ENTRADA_REPETIDA", mensaje: MENSAJE_ENTRADA_REPETIDA };
    vistos.add(e.renglonId);
  }
  for (const id of renglonIds) if (!vistos.has(id)) return { ok: false, codigo: "RENGLON_SIN_ENTRADAS", mensaje: MENSAJE_RENGLON_SIN_ENTRADAS };
  return { ok: true };
}

export type CodigoDeRechazoDeRegistroDeControl = "NO_ES_DE_ESTA_SUCURSAL" | "YA_ANULADA" | "YA_RECIBIDA";
export type DecisionDeRegistroDeControl = { ok: true } | { ok: false; codigo: CodigoDeRechazoDeRegistroDeControl; mensaje: string };

export interface EntradaDeRegistroDeControl {
  /** La parte pertenece a la sucursal activa de quien registra. */
  esDeLaSucursalDelActor: boolean;
  facturaAnulada: boolean;
  estadoDeLaParte: EstadoDeRecepcion;
}

const MENSAJE_CONTROL_COMPRA_YA_RECIBIDA = "Esta compra ya fue recibida: el control se registra antes de confirmar la recepción.";

/**
 * ¿Se puede registrar el control de las líneas de esa parte? Orden de las razones: la parte no es de esta sucursal (no se dice nada más: no se filtra la existencia) → la factura está anulada → la parte ya está recibida (el control solo existe antes de
 * confirmar). Puro y total.
 */
export function decidirRegistroDeControl(e: EntradaDeRegistroDeControl): DecisionDeRegistroDeControl {
  if (!e.esDeLaSucursalDelActor) return { ok: false, codigo: "NO_ES_DE_ESTA_SUCURSAL", mensaje: MENSAJE_RECEPCION_NO_ENCONTRADA };
  if (e.facturaAnulada) return { ok: false, codigo: "YA_ANULADA", mensaje: "La factura fue anulada: esta compra ya no se puede recibir." };
  if (e.estadoDeLaParte !== "PENDIENTE") return { ok: false, codigo: "YA_RECIBIDA", mensaje: MENSAJE_CONTROL_COMPRA_YA_RECIBIDA };
  return { ok: true };
}
