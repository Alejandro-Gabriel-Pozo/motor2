import { Decimal } from "decimal.js";
import { textoDeUnaLineaDesdeTexto } from "@/core/datos/texto-de-catalogo";
import { esDiaISOReal } from "@/core/tiempo/zona-horaria";

/**
 * Compras, orden de compra (etapa OC; docs/diseno-compras-n3b-n4-etapas-2026-11-16.md §«Etapa OC», corregido por docs/diseno-compras-contraste-sql-pedernal-2026-11-16.md; oráculo `docs/oraculo-combinaciones-compras-orden-2026-11-17.md`):
 * las reglas PURAS de la orden al proveedor. Sin base, sin Prisma, sin reloj propio (el «hoy» lo pone quien llama). El caso de uso las aplica con la cabecera de la orden bloqueada y la base las repite (disparadores de la migración
 * 20261117130000, como Pedernal 0066): acá se contrastan combinación por combinación con el oráculo. Días como texto ISO `AAAA-MM-DD` (día de calendario argentino): se comparan como texto.
 *
 * Ciclo: BORRADOR -> PEDIDA -> CERRADA | ANULADA (y BORRADOR -> ANULADA). «Recibida parcial» y «recibida» no se guardan: se calculan del saldo. SIN cierre automático y SIN reemplazo de órdenes (como Pedernal): se cierra a mano.
 */

export const ESTADOS_DE_ORDEN = ["BORRADOR", "PEDIDA", "CERRADA", "ANULADA"] as const;
export type EstadoDeOrden = (typeof ESTADOS_DE_ORDEN)[number];

export const ETIQUETA_DE_ESTADO_DE_ORDEN: Readonly<Record<EstadoDeOrden, string>> = {
  BORRADOR: "Borrador",
  PEDIDA: "Pedida",
  CERRADA: "Cerrada",
  ANULADA: "Anulada",
};

/** Por qué se cerró: la calcula la base al cerrar (COMPLETA si todas las líneas llegaron a lo pedido, CON_SALDO si no). */
export const MOTIVOS_DE_CIERRE = ["COMPLETA", "CON_SALDO"] as const;
export type MotivoDeCierre = (typeof MOTIVOS_DE_CIERRE)[number];
export const ETIQUETA_DE_MOTIVO_DE_CIERRE: Readonly<Record<MotivoDeCierre, string>> = {
  COMPLETA: "Completa",
  CON_SALDO: "Con saldo",
};

/** El único control con nivel hoy (el CHECK `NivelDeControl_control_chk` de la base dice lo mismo). */
export const CONTROL_RECEPCION_EXCEDE_LA_ORDEN = "compras.recepcion_excede_la_orden";
/** PERMITIR | AVISAR | BLOQUEAR (CHECK `NivelDeControl_nivel_chk`). SIN fila = PERMITIR (como Pedernal: el exceso pasa). */
export const NIVELES_DE_CONTROL = ["PERMITIR", "AVISAR", "BLOQUEAR"] as const;
export type NivelDeControl = (typeof NIVELES_DE_CONTROL)[number];
export const ETIQUETA_DE_NIVEL_DE_CONTROL: Readonly<Record<NivelDeControl, string>> = {
  PERMITIR: "Permitir",
  AVISAR: "Avisar",
  BLOQUEAR: "Bloquear",
};
export const NIVEL_POR_DEFECTO_DEL_CONTROL: NivelDeControl = "PERMITIR";

export function esNivelDeControl(valor: unknown): valor is NivelDeControl {
  return typeof valor === "string" && (NIVELES_DE_CONTROL as readonly string[]).includes(valor);
}

/** Tope del motivo de anulación (el CHECK de la base dice lo mismo). */
export const LARGO_MAXIMO_DEL_MOTIVO_DE_ORDEN = 500;
/** Cantidades: `Decimal(14,4)`, el CHECK de la base pide menos de 1e11; acá se pide menos de 1e10, como el resto de las cantidades. */
const CANTIDAD_MAXIMA = 1e10;
/** Precio por unidad de stock: `Decimal(14,4)`, el CHECK de la base pide menos de 1e10. */
const PRECIO_MAXIMO = 1e10;
const DECIMALES = 4;

export const MENSAJE_ORDEN_NO_ENCONTRADA = "No se encontró esa orden de compra.";

// ================================================================================================
// Datos de la orden (formato)
// ================================================================================================

export interface LineaDeOrdenCruda {
  productoId: unknown;
  cantidad: unknown;
  /** `null`/ausente = «sin precio» (como Pedernal). Un precio cero ES un precio (la base acepta `>= 0`). */
  precio?: unknown;
}

export interface LineaDeOrdenValidada {
  productoId: string;
  cantidad: number;
  precio: number | null;
}

export type CodigoDeRechazoDeDatosDeOrden = "SIN_PROVEEDOR" | "SIN_LINEAS" | "LINEA_SIN_PRODUCTO" | "CANTIDAD_INVALIDA" | "PRECIO_INVALIDO" | "ENTREGA_INVALIDA" | "ENTREGA_ANTERIOR_A_HOY" | "PRODUCTO_REPETIDO";

export type ResultadoDeDatosDeOrden =
  | { ok: true; valor: { proveedorId: string; sucursalId: string | null; fechaDeEntregaPrevista: string | null; lineas: LineaDeOrdenValidada[] } }
  | { ok: false; codigo: CodigoDeRechazoDeDatosDeOrden; mensaje: string };

const MENSAJE_SIN_PROVEEDOR = "Elegí el proveedor de la orden.";
const MENSAJE_SIN_LINEAS = "Agregá al menos una línea con una cantidad mayor que cero.";
const MENSAJE_LINEA_SIN_PRODUCTO = "Hay una línea sin producto.";
const MENSAJE_CANTIDAD_INVALIDA = "Cada cantidad tiene que ser un número mayor que cero, con hasta 4 decimales.";
const MENSAJE_PRECIO_INVALIDO = "Cada precio tiene que ser un número igual o mayor que cero, con hasta 4 decimales (o dejalo vacío si no hay precio).";
const MENSAJE_ENTREGA_INVALIDA = "La entrega prevista no es una fecha válida.";
const MENSAJE_ENTREGA_ANTERIOR_A_HOY = "La entrega prevista no puede ser anterior a hoy.";
const MENSAJE_PRODUCTO_REPETIDO = "Un producto no puede estar dos veces en la misma orden: juntá las cantidades.";

function esTextoNoVacio(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** ¿Es un número con a lo sumo 4 decimales? (aritmética decimal, sin flotantes). */
function tieneHastaCuatroDecimales(n: number): boolean {
  return new Decimal(n).times(new Decimal(10).pow(DECIMALES)).isInteger();
}

/**
 * ¿Sirven los datos de una orden nueva? Orden de las razones: proveedor → al menos una línea → cada línea: producto, cantidad (número finito > 0, menos de 1e10, hasta 4 decimales), precio (vacío, o número finito >= 0 con hasta 4 decimales),
 * y un mismo producto no se repite → entrega prevista (vacía o un día real, y no anterior a hoy). La sucursal destino es OPCIONAL (vacía = toda la empresa). Que el proveedor, la sucursal y los productos existan los mira el caso de uso con la base.
 * Puro y total: cada combinación tiene una sola respuesta.
 */
export function validarDatosDeOrden(d: {
  proveedorId: unknown;
  sucursalId?: unknown;
  fechaDeEntregaPrevista?: unknown;
  lineas: unknown;
  hoy: string;
}): ResultadoDeDatosDeOrden {
  const falla = (codigo: CodigoDeRechazoDeDatosDeOrden, mensaje: string): ResultadoDeDatosDeOrden => ({ ok: false, codigo, mensaje });
  if (!esTextoNoVacio(d.proveedorId)) return falla("SIN_PROVEEDOR", MENSAJE_SIN_PROVEEDOR);
  if (!Array.isArray(d.lineas) || d.lineas.length === 0) return falla("SIN_LINEAS", MENSAJE_SIN_LINEAS);
  const vistos = new Set<string>();
  const lineas: LineaDeOrdenValidada[] = [];
  for (const crudo of d.lineas as unknown[]) {
    const l = (crudo ?? {}) as Partial<LineaDeOrdenCruda>;
    if (!esTextoNoVacio(l.productoId)) return falla("LINEA_SIN_PRODUCTO", MENSAJE_LINEA_SIN_PRODUCTO);
    const cantidad = l.cantidad;
    if (typeof cantidad !== "number" || !Number.isFinite(cantidad) || cantidad <= 0 || cantidad >= CANTIDAD_MAXIMA || !tieneHastaCuatroDecimales(cantidad)) return falla("CANTIDAD_INVALIDA", MENSAJE_CANTIDAD_INVALIDA);
    let precio: number | null = null;
    if (l.precio !== undefined && l.precio !== null) {
      const p = l.precio;
      if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p >= PRECIO_MAXIMO || !tieneHastaCuatroDecimales(p)) return falla("PRECIO_INVALIDO", MENSAJE_PRECIO_INVALIDO);
      precio = p;
    }
    const productoId = l.productoId.trim();
    if (vistos.has(productoId)) return falla("PRODUCTO_REPETIDO", MENSAJE_PRODUCTO_REPETIDO);
    vistos.add(productoId);
    lineas.push({ productoId, cantidad, precio });
  }
  let fechaDeEntregaPrevista: string | null = null;
  if (d.fechaDeEntregaPrevista !== undefined && d.fechaDeEntregaPrevista !== null && d.fechaDeEntregaPrevista !== "") {
    if (!esDiaISOReal(d.fechaDeEntregaPrevista)) return falla("ENTREGA_INVALIDA", MENSAJE_ENTREGA_INVALIDA);
    if (d.fechaDeEntregaPrevista < d.hoy) return falla("ENTREGA_ANTERIOR_A_HOY", MENSAJE_ENTREGA_ANTERIOR_A_HOY);
    fechaDeEntregaPrevista = d.fechaDeEntregaPrevista;
  }
  const sucursalId = esTextoNoVacio(d.sucursalId) ? d.sucursalId.trim() : null;
  return { ok: true, valor: { proveedorId: d.proveedorId.trim(), sucursalId, fechaDeEntregaPrevista, lineas } };
}

// ================================================================================================
// Pedir, anular, cerrar (decisiones por estado)
// ================================================================================================

export type CodigoDeRechazoDeOrden =
  | "NO_ENCONTRADA"
  | "YA_PEDIDA"
  | "ORDEN_ANULADA"
  | "ORDEN_CERRADA"
  | "NO_ESTA_PEDIDA"
  | "SIN_LINEAS"
  | "ENTREGA_ANTERIOR_AL_PEDIDO"
  | "CON_RECEPCIONES"
  | "CON_RECEPCIONES_PENDIENTES"
  | "MOTIVO_OBLIGATORIO"
  | "MOTIVO_INVALIDO";

export type DecisionDeOrden = { ok: true } | { ok: false; codigo: CodigoDeRechazoDeOrden; mensaje: string };

export const MENSAJE_ORDEN_YA_PEDIDA = "Esta orden ya fue pedida.";
export const MENSAJE_ORDEN_ANULADA = "Esta orden está anulada.";
export const MENSAJE_ORDEN_CERRADA = "Esta orden ya está cerrada.";
export const MENSAJE_ORDEN_NO_ESTA_PEDIDA = "Solo se cierra una orden que ya fue pedida.";
const MENSAJE_ORDEN_SIN_LINEAS = "Una orden sin líneas no se pide.";
const MENSAJE_ORDEN_CON_RECEPCIONES = "Hay compras cargadas contra esta orden que siguen vigentes: anulá esas compras antes de anular la orden.";
const MENSAJE_ORDEN_CON_RECEPCIONES_PENDIENTES = "Hay compras pendientes de recibir contra esta orden: confirmá o anulá esas compras antes de cerrarla.";
const MENSAJE_MOTIVO_OBLIGATORIO = "Escribí el motivo de la anulación.";
const MENSAJE_MOTIVO_INVALIDO = `El motivo tiene caracteres que no se admiten o pasa de ${LARGO_MAXIMO_DEL_MOTIVO_DE_ORDEN} caracteres.`;

/**
 * ¿Se puede pedir la orden? Orden de las razones: BORRADOR es la única que se pide (PEDIDA → «ya pedida»; ANULADA y CERRADA se dicen como tales) → tiene al menos una línea que no se retiró → la entrega prevista no es anterior a hoy (el día
 * del pedido). Pedir es idempotente por estado: pedir dos veces da `YA_PEDIDA`, sin otro número. Puro y total.
 */
export function decidirPedirOrden(e: { estado: EstadoDeOrden; lineasNoRetiradas: number; fechaDeEntregaPrevista: string | null; hoy: string }): DecisionDeOrden {
  if (e.estado === "PEDIDA") return { ok: false, codigo: "YA_PEDIDA", mensaje: MENSAJE_ORDEN_YA_PEDIDA };
  if (e.estado === "ANULADA") return { ok: false, codigo: "ORDEN_ANULADA", mensaje: MENSAJE_ORDEN_ANULADA };
  if (e.estado === "CERRADA") return { ok: false, codigo: "ORDEN_CERRADA", mensaje: MENSAJE_ORDEN_CERRADA };
  if (e.lineasNoRetiradas < 1) return { ok: false, codigo: "SIN_LINEAS", mensaje: MENSAJE_ORDEN_SIN_LINEAS };
  if (e.fechaDeEntregaPrevista !== null && e.fechaDeEntregaPrevista < e.hoy) return { ok: false, codigo: "ENTREGA_ANTERIOR_AL_PEDIDO", mensaje: MENSAJE_ENTREGA_ANTERIOR_A_HOY };
  return { ok: true };
}

type ResultadoDeMotivo = { ok: true; valor: string } | { ok: false; codigo: "MOTIVO_OBLIGATORIO" | "MOTIVO_INVALIDO"; mensaje: string };

/** El motivo de anulación en su forma canónica (lista de PERMITIDOS de catálogo con `¿ ¡ ? ! % $`, una línea, hasta 500; vacío = obligatorio). La misma lista que el CHECK `OrdenDeCompra_motivoDeAnulacion_chk` de la base. */
export function validarMotivoDeAnulacionDeOrden(motivo: unknown): ResultadoDeMotivo {
  if (typeof motivo !== "string") return { ok: false, codigo: "MOTIVO_INVALIDO", mensaje: MENSAJE_MOTIVO_INVALIDO };
  if (motivo.trim() === "") return { ok: false, codigo: "MOTIVO_OBLIGATORIO", mensaje: MENSAJE_MOTIVO_OBLIGATORIO };
  const t = textoDeUnaLineaDesdeTexto(motivo, { maximo: LARGO_MAXIMO_DEL_MOTIVO_DE_ORDEN, exigirUnaLetra: false, conSignosDeCatalogo: true });
  if (!t.ok) return { ok: false, codigo: "MOTIVO_INVALIDO", mensaje: MENSAJE_MOTIVO_INVALIDO };
  return { ok: true, valor: t.valor };
}

/**
 * ¿Se puede anular la orden? Orden de las razones: ya anulada → cerrada (final) → hay compras vigentes (pendientes de recibir o ya recibidas, de facturas no anuladas) cargadas contra ella → el motivo (obligatorio). BORRADOR y PEDIDA se
 * anulan. Puro y total.
 */
export function decidirAnularOrden(e: { estado: EstadoDeOrden; hayRecepcionesVigentes: boolean; motivo: unknown }): DecisionDeOrden {
  if (e.estado === "ANULADA") return { ok: false, codigo: "ORDEN_ANULADA", mensaje: MENSAJE_ORDEN_ANULADA };
  if (e.estado === "CERRADA") return { ok: false, codigo: "ORDEN_CERRADA", mensaje: MENSAJE_ORDEN_CERRADA };
  if (e.hayRecepcionesVigentes) return { ok: false, codigo: "CON_RECEPCIONES", mensaje: MENSAJE_ORDEN_CON_RECEPCIONES };
  const m = validarMotivoDeAnulacionDeOrden(e.motivo);
  if (!m.ok) return { ok: false, codigo: m.codigo, mensaje: m.mensaje };
  return { ok: true };
}

/**
 * ¿Se puede cerrar la orden? Solo la PEDIDA, a mano (no hay cierre automático, como Pedernal) y sin compras pendientes de recibir contra ella. Un borrador no se cierra (se anula). Orden de las razones: ya cerrada → anulada → no está pedida
 * (borrador) → compras pendientes. Puro y total.
 */
export function decidirCerrarOrden(e: { estado: EstadoDeOrden; hayRecepcionesPendientes: boolean }): DecisionDeOrden {
  if (e.estado === "CERRADA") return { ok: false, codigo: "ORDEN_CERRADA", mensaje: MENSAJE_ORDEN_CERRADA };
  if (e.estado === "ANULADA") return { ok: false, codigo: "ORDEN_ANULADA", mensaje: MENSAJE_ORDEN_ANULADA };
  if (e.estado !== "PEDIDA") return { ok: false, codigo: "NO_ESTA_PEDIDA", mensaje: MENSAJE_ORDEN_NO_ESTA_PEDIDA };
  if (e.hayRecepcionesPendientes) return { ok: false, codigo: "CON_RECEPCIONES_PENDIENTES", mensaje: MENSAJE_ORDEN_CON_RECEPCIONES_PENDIENTES };
  return { ok: true };
}

/** Cómo va la recepción de una orden PEDIDA o CERRADA (se calcula, no se guarda). */
export type AvanceDeRecepcionDeOrden = "SIN_RECIBIR" | "RECIBIDA_PARCIAL" | "RECIBIDA";
export const ETIQUETA_DE_AVANCE_DE_RECEPCION: Readonly<Record<AvanceDeRecepcionDeOrden, string>> = {
  SIN_RECIBIR: "Sin recibir",
  RECIBIDA_PARCIAL: "Recibida parcial",
  RECIBIDA: "Recibida",
};

/** «Sin recibir» si nada llegó; «recibida» si TODAS las líneas llegaron a lo pedido (o más); «recibida parcial» en el medio. Sin líneas (un borrador) no hay avance: «sin recibir». */
export function avanceDeRecepcionDeOrden(lineas: readonly { cantidadPedida: number; cantidadRecibida: number }[]): AvanceDeRecepcionDeOrden {
  if (lineas.length === 0 || lineas.every((l) => l.cantidadRecibida <= 0)) return "SIN_RECIBIR";
  return lineas.every((l) => l.cantidadRecibida >= l.cantidadPedida) ? "RECIBIDA" : "RECIBIDA_PARCIAL";
}

// ================================================================================================
// Recibir contra una orden: vínculo del renglón y control de exceso
// ================================================================================================

export type CodigoDeRechazoDeVinculo =
  | "ORDEN_NO_PEDIDA"
  | "PROVEEDOR_DISTINTO"
  | "LINEA_RETIRADA"
  | "PRODUCTO_DISTINTO"
  | "EXCEDE_LA_ORDEN_BLOQUEADA"
  | "EXCEDE_LA_ORDEN_SIN_CONFIRMAR";

export type DecisionDeVinculo = { ok: true } | { ok: false; codigo: CodigoDeRechazoDeVinculo; mensaje: string };

export const MENSAJE_VINCULO_ORDEN_NO_PEDIDA = "Solo se recibe contra una orden que está pedida.";
const MENSAJE_VINCULO_PROVEEDOR_DISTINTO = "El proveedor de la compra no es el de la orden.";
const MENSAJE_VINCULO_LINEA_RETIRADA = "Esa línea de la orden se retiró.";
const MENSAJE_VINCULO_PRODUCTO_DISTINTO = "El producto del renglón no es el de la línea de la orden.";
export const MENSAJE_EXCEDE_LA_ORDEN_BLOQUEADA = "Lo que recibís supera lo pedido en la orden y el control no lo permite.";
export const MENSAJE_EXCEDE_LA_ORDEN_SIN_CONFIRMAR = "Lo que recibís supera lo pedido en la orden: confirmá que querés recibir de más.";

/** El resultado del control de exceso de un renglón: pasa, o lo frena el nivel BLOQUEAR, o lo frena el nivel AVISAR porque no se confirmó el exceso. */
export type ResultadoDelExceso = "PASA" | "BLOQUEADA" | "SIN_CONFIRMAR";

/**
 * El control `compras.recepcion_excede_la_orden`, IDÉNTICO al de Pedernal 0066 (`v_exige := nivel = 'BLOQUEAR' OR (nivel = 'AVISAR' AND NOT confirmo_exceso)`; el tope viaja en el WHERE del UPDATE del saldo): con `nivel` ausente (sin fila) es PERMITIR; el exceso
 * pasa en PERMITIR siempre y en AVISAR si se confirmó; se frena en BLOQUEAR siempre y en AVISAR si no se confirmó. «Exceso» es que lo ya recibido más lo de este renglón supere lo pedido. Un renglón RECHAZADO por el control de la recepción NO cuenta contra la
 * orden (no suma al saldo, así que tampoco se le aplica el tope). Puro y total.
 */
export function decidirExcesoContraLaOrden(e: {
  nivel: NivelDeControl | null;
  confirmoExceso: boolean;
  recibidaHasta: number;
  cantidad: number;
  pedida: number;
  rechazadoPorElControl: boolean;
}): ResultadoDelExceso {
  if (e.rechazadoPorElControl) return "PASA";
  const nivel = e.nivel ?? NIVEL_POR_DEFECTO_DEL_CONTROL;
  const exige = nivel === "BLOQUEAR" || (nivel === "AVISAR" && !e.confirmoExceso);
  if (!exige) return "PASA";
  const supera = new Decimal(e.recibidaHasta).plus(e.cantidad).greaterThan(e.pedida);
  if (!supera) return "PASA";
  return nivel === "BLOQUEAR" ? "BLOQUEADA" : "SIN_CONFIRMAR";
}

/**
 * ¿Se puede vincular un renglón de una compra pendiente con una línea de una orden? Orden de las razones (como el disparador de la base): la orden está PEDIDA → mismo proveedor → la línea no se retiró → mismo producto → el control de exceso (aviso temprano:
 * el tope firme se vuelve a imponer al confirmar la recepción). Puro y total.
 */
export function decidirVinculoConOrden(e: {
  estadoDeLaOrden: EstadoDeOrden;
  mismoProveedor: boolean;
  lineaRetirada: boolean;
  mismoProducto: boolean;
  nivel: NivelDeControl | null;
  confirmoExceso: boolean;
  recibidaHasta: number;
  cantidad: number;
  pedida: number;
}): DecisionDeVinculo {
  if (e.estadoDeLaOrden !== "PEDIDA") return { ok: false, codigo: "ORDEN_NO_PEDIDA", mensaje: MENSAJE_VINCULO_ORDEN_NO_PEDIDA };
  if (!e.mismoProveedor) return { ok: false, codigo: "PROVEEDOR_DISTINTO", mensaje: MENSAJE_VINCULO_PROVEEDOR_DISTINTO };
  if (e.lineaRetirada) return { ok: false, codigo: "LINEA_RETIRADA", mensaje: MENSAJE_VINCULO_LINEA_RETIRADA };
  if (!e.mismoProducto) return { ok: false, codigo: "PRODUCTO_DISTINTO", mensaje: MENSAJE_VINCULO_PRODUCTO_DISTINTO };
  const exceso = decidirExcesoContraLaOrden({ nivel: e.nivel, confirmoExceso: e.confirmoExceso, recibidaHasta: e.recibidaHasta, cantidad: e.cantidad, pedida: e.pedida, rechazadoPorElControl: false });
  if (exceso === "BLOQUEADA") return { ok: false, codigo: "EXCEDE_LA_ORDEN_BLOQUEADA", mensaje: MENSAJE_EXCEDE_LA_ORDEN_BLOQUEADA };
  if (exceso === "SIN_CONFIRMAR") return { ok: false, codigo: "EXCEDE_LA_ORDEN_SIN_CONFIRMAR", mensaje: MENSAJE_EXCEDE_LA_ORDEN_SIN_CONFIRMAR };
  return { ok: true };
}
