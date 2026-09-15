import type { Proceso } from "@prisma/client";
import type { AccionClave } from "@/core/permisos/acciones";

/**
 * Port de TRANSICIONES (Movimientos.js:61-348) — fuente única de qué hace
 * cada proceso, mismo criterio que ya defendió Apps Script después del bug
 * de v2.1.0 (Merma sin signo: una segunda lista de signos, separada de
 * TRANSICIONES, no se actualizó al agregar el proceso nuevo).
 *
 * DIFERENCIA CLAVE con Apps Script: acá `signoStock` se usa UNA sola vez,
 * al construir `MovimientoStock.cantidad` antes de escribir (ver
 * registrarMovimiento) — nunca al leer. El saldo de cualquier
 * producto/sección/lote es siempre `SUM(cantidad)`, sin excepción por
 * proceso (ver prisma/schema.prisma, docstring de MovimientoStock).
 *
 * `filtroUso` de Apps Script no se porta: "Uso" ya no existe como dato
 * persistido (porción Catálogo, usoDeTipo) — es 100% derivable de `tipo`,
 * así que donde Apps Script filtraba por Uso (solo COMPRA) acá se filtra
 * por `tipo === 'MP'` directo (ver productoValidoParaProceso).
 */
export interface Transicion {
  /** +1 entra, −1 sale: el usuario carga una MAGNITUD positiva, se multiplica por esto al escribir. 0 = el valor ya viene con el signo puesto (Ajuste/Control) o lo arma el propio motor (Transferencia) — ver esSignoFijo. */
  signoStock: 1 | -1 | 0;
  /** Ajuste/Control: la diferencia puede ser exactamente 0 (sin movimiento real, solo se registra el conteo/ajuste en 0). */
  permiteCero: boolean;
  /**
   * true: solo participan productos con tieneStockReal(tipo, seProduce)
   * true (MP siempre, PV solo si "Se produce" — Movimientos.js:544-566).
   * Cubre también Producción a propósito: la regla real ahí ("MP siempre
   * producible, PV solo si Se produce") es exactamente tieneStockReal.
   */
  requiereStockReal: boolean;
  /** Compra/Devolución a Proveedor: convierte de unidad de Compra a unidad de Stock (factor del producto o de una Presentación alternativa; ver armarLineaMovimiento). */
  aplicaFactorConversion: boolean;
  /** Producción: además de la línea del producto, genera 1+ líneas de Consumo por su receta (Venta hace lo mismo pero por su propio camino, registrarVenta — no pasa por el motor genérico). */
  generaConsumoDeReceta: boolean;
  /**
   * Sección siempre obligatoria (decisión 2026-09-13, IDEA-conteo-fisico-
   * por-lote.md): procesos que REPARTEN stock ya existente exigen elegir
   * sección explícitamente, nunca se adivina. Compra/Producción/
   * DevoluciónCliente/Venta dan de alta stock nuevo — no hay ambigüedad de
   * "dónde ya está" que resolver. Transferencia tampoco: el origen ya es
   * un campo obligatorio propio (seccionId de DatosMovimiento).
   *
   * A diferencia de Apps Script (donde una sección vacía caía en
   * SECCION_POR_DEFECTO='General' en silencio), acá `seccionId` es
   * SIEMPRE un FK obligatorio en la firma de la acción — este flag es solo
   * para que la UI sepa si tiene que exigir la elección al operario o
   * puede preseleccionar "General" sin preguntar.
   */
  exigeSeccion: boolean;
}

export const TRANSICIONES: Record<Proceso, Transicion> = {
  COMPRA: { signoStock: 1, permiteCero: false, requiereStockReal: false, aplicaFactorConversion: true, generaConsumoDeReceta: false, exigeSeccion: false },
  PRODUCCION: { signoStock: 1, permiteCero: false, requiereStockReal: true, aplicaFactorConversion: false, generaConsumoDeReceta: true, exigeSeccion: false },
  CONSUMO: { signoStock: -1, permiteCero: false, requiereStockReal: true, aplicaFactorConversion: false, generaConsumoDeReceta: false, exigeSeccion: true },
  AJUSTE: { signoStock: 0, permiteCero: true, requiereStockReal: true, aplicaFactorConversion: false, generaConsumoDeReceta: false, exigeSeccion: true },
  CONTROL: { signoStock: 0, permiteCero: true, requiereStockReal: true, aplicaFactorConversion: false, generaConsumoDeReceta: false, exigeSeccion: true },
  TRANSFERENCIA: { signoStock: 0, permiteCero: false, requiereStockReal: true, aplicaFactorConversion: false, generaConsumoDeReceta: false, exigeSeccion: false },
  MERMA: { signoStock: -1, permiteCero: false, requiereStockReal: true, aplicaFactorConversion: false, generaConsumoDeReceta: false, exigeSeccion: true },
  // Venta no pasa por el motor genérico (armarPreviaVentaDesdeItems_ es su
  // propio camino en Apps Script) — requiereStockReal acá es informativo:
  // la regla real es "solo PV" (registrarVenta), no tieneStockReal.
  VENTA: { signoStock: -1, permiteCero: false, requiereStockReal: false, aplicaFactorConversion: false, generaConsumoDeReceta: true, exigeSeccion: false },
  DEVOLUCION_CONSIGNACION: { signoStock: -1, permiteCero: false, requiereStockReal: true, aplicaFactorConversion: false, generaConsumoDeReceta: false, exigeSeccion: true },
  // Nunca la elige un usuario (generada sola por registrarVenta/registrarMovimiento
  // al consumir una MP esConsignacion) — sin Accion propia, ver ACCION_POR_PROCESO.
  LIQUIDACION_CONSIGNACION: { signoStock: 0, permiteCero: true, requiereStockReal: false, aplicaFactorConversion: false, generaConsumoDeReceta: false, exigeSeccion: false },
  DEVOLUCION_CLIENTE: { signoStock: 1, permiteCero: false, requiereStockReal: true, aplicaFactorConversion: false, generaConsumoDeReceta: false, exigeSeccion: false },
  DEVOLUCION_PROVEEDOR: { signoStock: -1, permiteCero: false, requiereStockReal: true, aplicaFactorConversion: true, generaConsumoDeReceta: false, exigeSeccion: true },
  // Primitiva de la porción Stock (reclasificarStock, Stock.js:1899-1991)
  // — NUNCA pasa por este motor genérico ni por TRANSICIONES en Apps
  // Script (arma sus propias líneas con signo ya puesto). Esta entrada
  // existe solo para que Record<Proceso, Transicion> quede exhaustivo;
  // ningún código la consulta de verdad.
  RECLASIFICACION: { signoStock: 0, permiteCero: false, requiereStockReal: true, aplicaFactorConversion: false, generaConsumoDeReceta: false, exigeSeccion: true },
};

/** true = magnitud positiva que hay que firmar con signoStock; false = Ajuste/Control (el usuario ya carga el delta con signo) o Transferencia (el motor arma las 2 líneas él mismo). */
export function esSignoFijo(proceso: Proceso): boolean {
  return TRANSICIONES[proceso].signoStock !== 0;
}

/** Port de tieneStockReal_ (Movimientos.js:564-566). */
export function tieneStockReal(tipo: "MP" | "PV", seProduce: boolean): boolean {
  return tipo === "MP" || (tipo === "PV" && seProduce);
}

/**
 * Port de productoValidoParaProceso_ (Movimientos.js:568-606), sin
 * filtroUso (ver docstring de Transicion) y sin la rama de Producción por
 * separado (tieneStockReal ya cubre exactamente esa regla).
 */
export function productoValidoParaProceso(
  proceso: Proceso,
  producto: { tipo: "MP" | "PV"; seProduce: boolean; esConsignacion: boolean }
): boolean {
  const t = TRANSICIONES[proceso];

  // Uso 1:1 Tipo (porción Catálogo, usoDeTipo): comprar siempre es de una MP.
  if (proceso === "COMPRA" && producto.tipo !== "MP") return false;

  if (t.requiereStockReal && !tieneStockReal(producto.tipo, producto.seProduce)) return false;

  // Sesión "consignación" (Movimientos.js:593-603): no se puede devolver al
  // consignante algo que no se recibió en consignación, y viceversa — un
  // producto en consignación nunca se "compró", así que DEVOLUCION_PROVEEDOR
  // no es su camino.
  if (proceso === "DEVOLUCION_CONSIGNACION" && !producto.esConsignacion) return false;
  if (proceso === "DEVOLUCION_PROVEEDOR" && producto.esConsignacion) return false;

  return true;
}

/**
 * Qué Accion (permisos, acciones.ts) gatea cada proceso — port de
 * ACCION_POR_PROCESO_ (Movimientos.js:510-525). LIQUIDACION_CONSIGNACION
 * deliberadamente no tiene entrada: nunca es una acción de usuario.
 */
export const ACCION_POR_PROCESO: Partial<Record<Proceso, AccionClave>> = {
  COMPRA: "proceso_compra",
  PRODUCCION: "proceso_produccion",
  CONSUMO: "proceso_consumo",
  AJUSTE: "proceso_ajuste",
  CONTROL: "proceso_control",
  TRANSFERENCIA: "proceso_transferencia",
  MERMA: "proceso_merma",
  VENTA: "proceso_venta",
  DEVOLUCION_CONSIGNACION: "proceso_devolucion_consignacion",
  DEVOLUCION_CLIENTE: "proceso_devolucion_cliente",
  DEVOLUCION_PROVEEDOR: "proceso_devolucion_proveedor",
};

/** Port de redondearACantidadDeUnidad_ — la cantidad que entra al Kardex se redondea a los decimales que acepta su unidad de stock (Unidad.decimales). */
export function redondearACantidadDeUnidad(cantidad: number, decimales: number): number {
  const factor = 10 ** decimales;
  return Math.round(cantidad * factor) / factor;
}

/** Port de redondearMoneda_ — 2 decimales fijos, para precios/importes. */
export function redondearMoneda(n: number): number {
  return Math.round(n * 100) / 100;
}
