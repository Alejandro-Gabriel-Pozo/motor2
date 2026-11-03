import { estadoDelNumeroTecleado, type PartesDeNumeroDeComprobante } from "@/core/datos/numero-comprobante";
import { numeroDelCampo } from "@/core/datos/numero-tecleado";
import { esDiaISOReal } from "@/core/tiempo/zona-horaria";

/**
 * Lógica PURA de la pantalla de Compra por pasos (etapa 1 de Compras, paso 6; docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md §9): qué pasos hay, qué exige cada uno para avanzar, en qué unidad se
 * interpreta la cantidad de una línea (la precarga y la elección a mano), los precios que la pantalla CALCULA solo para mostrar y los avisos de la revisión. Sin reloj, entorno ni Prisma (P0): la pantalla pasa
 * «hoy» y los textos tecleados. Nada de esto se manda al servidor: el servidor revalida todo por su cuenta (esto solo evita ir y volver).
 */

export type PasoDeCompra = "FACTURA" | "LINEAS" | "DONDE" | "PAGO" | "REVISAR";

export const PASOS_DE_COMPRA: readonly { id: PasoDeCompra; titulo: string }[] = [
  { id: "FACTURA", titulo: "Factura" },
  { id: "LINEAS", titulo: "Qué compraste" },
  { id: "DONDE", titulo: "Dónde entra" },
  { id: "PAGO", titulo: "Pago" },
  { id: "REVISAR", titulo: "Revisar y confirmar" },
];

/** El paso que sigue (o el mismo, si es el último). */
export function pasoSiguiente(paso: PasoDeCompra): PasoDeCompra {
  const i = PASOS_DE_COMPRA.findIndex((p) => p.id === paso);
  return PASOS_DE_COMPRA[Math.min(i + 1, PASOS_DE_COMPRA.length - 1)].id;
}

/** El paso anterior (o el mismo, si es el primero). */
export function pasoAnterior(paso: PasoDeCompra): PasoDeCompra {
  const i = PASOS_DE_COMPRA.findIndex((p) => p.id === paso);
  return PASOS_DE_COMPRA[Math.max(i - 1, 0)].id;
}

/** Por qué no se puede avanzar: el mensaje y, si es de una línea, cuál (índice en la lista de la pantalla). */
export interface ErrorDePaso {
  mensaje: string;
  fila?: number;
  campo?: "vencimiento";
}

// ───────────────────────── Unidades ─────────────────────────

/** Una unidad en que se puede comprar un producto: `factor` es cuántas unidades de stock trae una de compra. */
export interface UnidadDeCompra {
  unidadCompraId: string;
  nombre: string;
  factor: number;
}

/**
 * Las unidades de compra de un producto: la POR DEFECTO (la unidad de compra del producto con su factor, o su unidad de stock con el mismo factor si no tiene unidad de compra: lo mismo que arma el servidor en
 * `armarLineaDeMovimiento`) y las presentaciones ACTIVAS. Una línea con `unidadCompraId` vacío se interpreta en la por defecto.
 */
export interface UnidadesDeCompraDelProducto {
  unidadStockNombre: string;
  porDefecto: UnidadDeCompra;
  presentaciones: UnidadDeCompra[];
}

/** La unidad en que se interpreta la cantidad: la presentación activa elegida o, si no hay (vacío o ya no es activa), la por defecto. Es lo que hace el servidor (`cargarPresentacionActiva` devuelve null y sigue con la por defecto). */
export function unidadEfectiva(unidades: UnidadesDeCompraDelProducto, elegidaId: string): UnidadDeCompra {
  if (elegidaId === "" || elegidaId === unidades.porDefecto.unidadCompraId) return unidades.porDefecto;
  return unidades.presentaciones.find((p) => p.unidadCompraId === elegidaId) ?? unidades.porDefecto;
}

/** «Caja (×12)»; la unidad que no convierte (factor 1) va sola: «kg». */
export function etiquetaDeUnidad(unidad: UnidadDeCompra): string {
  return unidad.factor === 1 ? unidad.nombre : `${unidad.nombre} (×${unidad.factor})`;
}

export interface UnidadDeLaPrecarga {
  /** Lo que lleva la fila: vacío = la por defecto (así llega al servidor), o el id de una presentación activa. */
  unidadCompraId: string;
  /** `false` si la unidad de la última compra al proveedor ya no sirve (presentación desactivada o que no existe): la fila cae a la por defecto y hay que confirmarla. */
  vigente: boolean;
}

/**
 * La unidad con que arranca una fila precargada desde el proveedor: la del vínculo (la de la última compra) si sigue válida —es la unidad de compra por defecto del producto o una presentación ACTIVA—; si no, la por
 * defecto, marcada como no vigente. El vínculo sin unidad (compras viejas sin dato) no tiene nada que confirmar. Si la unidad es la por defecto se manda vacía: el servidor la trata igual (sin fila de presentación
 * `cargarPresentacionActiva` da null y sigue con la por defecto), y vacío es lo que ya manda la pantalla al elegir un producto a mano.
 */
export function decidirUnidadDePrecarga(unidadDelVinculoId: string, unidades: UnidadesDeCompraDelProducto): UnidadDeLaPrecarga {
  if (unidadDelVinculoId === "" || unidadDelVinculoId === unidades.porDefecto.unidadCompraId) return { unidadCompraId: "", vigente: true };
  if (unidades.presentaciones.some((p) => p.unidadCompraId === unidadDelVinculoId)) return { unidadCompraId: unidadDelVinculoId, vigente: true };
  return { unidadCompraId: "", vigente: false };
}

/** El texto de la fila cuando la unidad de la última compra ya no está activa. */
export function avisoDeUnidadNoVigente(nombreDeLaUnidad: string): string {
  return `La última vez se compró en ${nombreDeLaUnidad}, que ya no está activa: confirmá la unidad.`;
}

// ───────────────────────── Peso real ─────────────────────────

/**
 * ¿Se muestra el campo «Peso real» en una línea de compra? Hoy SIEMPRE, en toda línea. Es el único lugar donde se decide, para que la regla de tipos distintos de unidad (cuándo tiene sentido pedir los kilos) se
 * cambie acá sin tocar la pantalla.
 */
export function seMuestraElPesoReal(): boolean {
  // regla de tipos distintos: migración 2a, §14.2
  return true;
}

// ───────────────────────── Precios para mostrar ─────────────────────────

const redondear4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Cuánto entra al stock: el peso real si viene (> 0), si no cantidad × factor. `null` si todavía no hay cantidad válida. */
export function cantidadEnStock(datos: { cantidad: number | undefined; factor: number; pesoReal: number | undefined }): number | null {
  if (datos.pesoReal !== undefined && Number.isFinite(datos.pesoReal) && datos.pesoReal > 0) return redondear4(datos.pesoReal);
  if (datos.cantidad !== undefined && Number.isFinite(datos.cantidad) && datos.cantidad > 0) return redondear4(datos.cantidad * datos.factor);
  return null;
}

/** importe / cantidad, solo para mostrar. `null` si falta el importe o la cantidad no es positiva. Un importe 0 da 0. */
export function precioPorUnidad(importe: number | undefined, cantidad: number | null | undefined): number | null {
  if (importe === undefined || !Number.isFinite(importe)) return null;
  if (cantidad === null || cantidad === undefined || !Number.isFinite(cantidad) || cantidad <= 0) return null;
  return redondear4(importe / cantidad);
}

// ───────────────────────── Validación por paso ─────────────────────────

/** Paso 1: proveedor, fecha (un día real, no futuro) y número armado. */
export function validarPasoFactura(datos: { proveedorId: string; fecha: string; hoy: string; numero: PartesDeNumeroDeComprobante }): ErrorDePaso | null {
  if (!datos.proveedorId) return { mensaje: "Elegí el proveedor." };
  if (!datos.fecha) return { mensaje: "Elegí la fecha de la factura." };
  if (!esDiaISOReal(datos.fecha)) return { mensaje: "Esa fecha no existe: elegí un día real." };
  if (datos.fecha > datos.hoy) return { mensaje: "La fecha de la factura no puede ser posterior a hoy." };
  const numero = estadoDelNumeroTecleado(datos.numero);
  if (numero.tipo === "vacio") return { mensaje: "Falta el número de la factura: letra, punto de venta y número." };
  if (numero.tipo === "error") return { mensaje: numero.mensaje };
  return null;
}

/** Lo que el paso 2 necesita saber de cada línea de la pantalla. */
export interface LineaParaValidar {
  productoId: string;
  /** Nombre del producto para los mensajes («Harina»); puede faltar un instante mientras se carga. */
  nombre: string;
  cantidad: string;
  loteVencimiento: string;
  referenciaProveedor: string;
  /** El producto ya se le compró a este proveedor: «cómo lo llama» no es obligatorio. */
  yaVinculado: boolean;
  /** La unidad de la última compra ya no está activa y todavía no se confirmó la que quedó. */
  unidadSinConfirmar: boolean;
}

const sujeto = (l: LineaParaValidar) => (l.nombre ? `«${l.nombre}»` : "una línea");

/**
 * Paso 2: al menos una línea con producto y cantidad. Una fila completamente vacía se ignora (igual que al enviar); una con producto y sin cantidad, o con cantidad y sin producto, frena. Cada línea
 * que se va a guardar tiene que tener cantidad numérica mayor que 0, un vencimiento real (si lo trae), la referencia del proveedor si es la primera compra del producto y la unidad confirmada si hacía falta.
 */
export function validarPasoLineas(lineas: readonly LineaParaValidar[]): ErrorDePaso | null {
  let hay = false;
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    const vacia = !l.productoId && l.cantidad === "" && l.loteVencimiento === "" && l.referenciaProveedor.trim() === "";
    if (vacia) continue;
    if (!l.productoId) return { mensaje: "Elegí el insumo de cada línea (o quitá la línea que no usás).", fila: i };
    if (l.cantidad === "") return { mensaje: `Falta la cantidad de ${sujeto(l)}.`, fila: i };
    const cantidad = numeroDelCampo(l.cantidad);
    if (cantidad === undefined || !Number.isFinite(cantidad) || cantidad <= 0) return { mensaje: `La cantidad de ${sujeto(l)} tiene que ser un número mayor que 0.`, fila: i };
    if (l.loteVencimiento !== "" && !esDiaISOReal(l.loteVencimiento)) return { mensaje: "Ese día no existe: elegí un vencimiento real (día/mes/año).", fila: i, campo: "vencimiento" };
    if (!l.yaVinculado && l.referenciaProveedor.trim() === "") {
      return { mensaje: `Escribí cómo lo llama el proveedor a ${sujeto(l)} (código y descripción, como dice la factura): es la primera compra de ese producto a este proveedor.`, fila: i };
    }
    if (l.unidadSinConfirmar) return { mensaje: `Confirmá la unidad de ${sujeto(l)}.`, fila: i };
    hay = true;
  }
  if (!hay) return { mensaje: "Cargá al menos un insumo con cantidad." };
  return null;
}

/** Paso 3: el depósito. */
export function validarPasoDonde(datos: { seccionId: string }): ErrorDePaso | null {
  return datos.seccionId ? null : { mensaje: "Elegí el depósito donde entra la mercadería." };
}

// ───────────────────────── Revisión ─────────────────────────

/** «Importe 0: la compra se guarda, pero no actualiza el costo de "Harina".» */
export function avisoDeImporteCero(nombreDelProducto: string): string {
  return `Importe 0: la compra se guarda, pero no actualiza el costo de "${nombreDelProducto}".`;
}

/** Un aviso por cada línea con producto y cantidad cuyo importe es 0 o está vacío (el servidor guarda 0 en los dos casos). No bloquea. */
export function avisosDeImporteCero(lineas: readonly { nombre: string; cantidad: string; importe: string }[]): string[] {
  return lineas.filter((l) => l.nombre && l.cantidad !== "" && (numeroDelCampo(l.importe) ?? 0) === 0).map((l) => avisoDeImporteCero(l.nombre));
}

/** El mensaje que queda después de confirmar: el del servidor y, si hubo líneas con importe 0, el mismo aviso de la revisión. */
export function mensajeFinalDeCompra(mensajeDelServidor: string, avisos: readonly string[]): string {
  return avisos.length ? `${mensajeDelServidor} ${avisos.join(" ")}` : mensajeDelServidor;
}
