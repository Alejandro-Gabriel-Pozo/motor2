import { Decimal } from "decimal.js";
import { textoDeUnaLineaDesdeTexto } from "@/core/datos/texto-de-catalogo";
import { aCentavos, repartirEnteros } from "./reparto-de-factura";

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
/** La sección dada de baja no lleva mensaje propio: el texto único `mensajeSeccionDesactivada` necesita el nombre de la sección y lo pone el caso de uso. */
export type DecisionDeConfirmacionDeRecepcion =
  | { ok: true }
  | { ok: false; codigo: Exclude<CodigoDeRechazoDeRecepcion, "SECCION_INACTIVA">; mensaje: string }
  | { ok: false; codigo: "SECCION_INACTIVA" };

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
  if (e.seccion === "INACTIVA") return { ok: false, codigo: "SECCION_INACTIVA" };
  if (e.diaStock < e.diaFactura || e.diaStock > e.hoy) return { ok: false, codigo: "FECHA_FUERA_DE_RANGO", mensaje: mensajeFechaDeStockFueraDeRango(e.diaFactura, e.hoy) };
  return { ok: true };
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

/** Lo que la regla necesita saber de cada renglón de mercadería de la compra pendiente. `decimales` es la precisión de la unidad de stock del producto. */
interface RenglonParaEntradas {
  renglonId: string;
  cantidad: number;
  decimales: number;
}

export interface EntradaDeRecepcion {
  renglonId: string;
  seccionId: string;
  cantidad: number;
}

export type CodigoDeRechazoDeEntradas = "SIN_ENTRADAS" | "RENGLON_AJENO" | "ENTRADA_REPETIDA" | "CANTIDAD_INVALIDA" | "CANTIDAD_NO_SUMA" | "RENGLON_SIN_ENTRADAS";

type ResultadoDeEntradas = { ok: true } | { ok: false; codigo: CodigoDeRechazoDeEntradas; mensaje: string };

const MENSAJE_SIN_ENTRADAS = "Indicá la sección donde entra cada renglón de la compra.";
const MENSAJE_RENGLON_AJENO = "Hay un renglón que no es de esta compra.";
const MENSAJE_ENTRADA_REPETIDA = "Un renglón no puede entrar dos veces en la misma sección: juntá las cantidades.";
const MENSAJE_RENGLON_SIN_ENTRADAS = "Falta indicar la sección donde entra uno de los renglones de la compra.";

/**
 * ¿Sirven las entradas de stock de la recepción? Cada entrada es `{ renglón, sección, cantidad }`: un renglón puede FRACCIONARSE entre varias secciones. Reglas, en este orden: hay al menos una entrada → cada renglón es de la compra → no se repite
 * (renglón, sección) → cada cantidad es mayor que cero, con hasta los decimales de la unidad del producto y no más de 4 → todo renglón de mercadería de la compra tiene entradas → por cada renglón, la SUMA de sus entradas es EXACTAMENTE su
 * cantidad (aritmética en pasos enteros de 10^-4, sin flotantes). Que cada sección sea propia de la sucursal y esté activa lo mira `decidirConfirmacionDeRecepcion` con lo que lee el caso de uso.
 * DIFERENCIA con Pedernal, declarada: allá la suma de las entradas de una línea tiene que ser MENOR O IGUAL a lo recibido (`entrada_de_linea_excede_lo_recibido`, en su recepción hay una cantidad recibida aparte de la pedida); en Motor2 la
 * única cantidad es la del renglón de la factura (lo facturado) y no hay otra «recibida», así que la suma es EXACTA. El faltante físico se registra después, en la etapa de diferencias (tres vías).
 */
export function validarEntradasDeRecepcion(renglones: readonly RenglonParaEntradas[], entradas: readonly EntradaDeRecepcion[]): ResultadoDeEntradas {
  if (entradas.length === 0) return { ok: false, codigo: "SIN_ENTRADAS", mensaje: MENSAJE_SIN_ENTRADAS };
  const porId = new Map(renglones.map((r) => [r.renglonId, r]));
  const vistas = new Set<string>();
  const sumaPorRenglon = new Map<string, number>();
  for (const e of entradas) {
    const r = porId.get(e.renglonId);
    if (!r) return { ok: false, codigo: "RENGLON_AJENO", mensaje: MENSAJE_RENGLON_AJENO };
    const clave = JSON.stringify([e.renglonId, e.seccionId]);
    if (vistas.has(clave)) return { ok: false, codigo: "ENTRADA_REPETIDA", mensaje: MENSAJE_ENTRADA_REPETIDA };
    vistas.add(clave);
    const pasos = typeof e.cantidad === "number" && Number.isFinite(e.cantidad) && e.cantidad > 0 && e.cantidad < CANTIDAD_MAXIMA_SEGUN_REMITO ? pasosEnteros(e.cantidad) : null;
    const pasosDeLaUnidad = pasos === null ? null : new Decimal(e.cantidad).times(new Decimal(10).pow(r.decimales));
    if (pasos === null || pasosDeLaUnidad === null || !pasosDeLaUnidad.isInteger()) {
      return { ok: false, codigo: "CANTIDAD_INVALIDA", mensaje: mensajeDeCantidadInvalida(r.decimales) };
    }
    sumaPorRenglon.set(e.renglonId, (sumaPorRenglon.get(e.renglonId) ?? 0) + pasos);
  }
  for (const r of renglones) {
    const suma = sumaPorRenglon.get(r.renglonId);
    if (suma === undefined) return { ok: false, codigo: "RENGLON_SIN_ENTRADAS", mensaje: MENSAJE_RENGLON_SIN_ENTRADAS };
    const esperado = pasosEnteros(r.cantidad);
    if (esperado === null || suma !== esperado) {
      return { ok: false, codigo: "CANTIDAD_NO_SUMA", mensaje: `Las cantidades repartidas entre las secciones tienen que sumar exactamente ${formatearCantidad(r.cantidad)}, la cantidad del renglón.` };
    }
  }
  return { ok: true };
}

function mensajeDeCantidadInvalida(decimales: number): string {
  return decimales === 0
    ? "Cada cantidad tiene que ser un número entero mayor que cero (la unidad del producto no admite decimales)."
    : `Cada cantidad tiene que ser mayor que cero, con hasta ${decimales} decimales (la precisión de la unidad del producto).`;
}

function formatearCantidad(n: number): string {
  return new Decimal(n).toString().replace(".", ",");
}

/**
 * El precio TOTAL de un renglón repartido entre sus entradas, en proporción exacta a la cantidad de cada una: devuelve el precio de cada entrada (en pesos, con 2 decimales) y la SUMA da EXACTAMENTE `precioTotal` (en centavos enteros,
 * por MAYOR RESIDUO con `repartirEnteros`: la regla de reparto exacto del repo; a igual resto gana la primera entrada). Con una sola entrada devuelve el precio entero. El precio por unidad de stock del renglón es el mismo para todas.
 */
export function prorratearPrecioDeRenglon(precioTotal: number, cantidades: readonly number[]): number[] {
  const centavos = aCentavos(precioTotal);
  const pesos = cantidades.map((c) => pasosEnteros(c) ?? 0);
  return repartirEnteros(centavos, pesos).map((c) => new Decimal(c).dividedBy(100).toNumber());
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
