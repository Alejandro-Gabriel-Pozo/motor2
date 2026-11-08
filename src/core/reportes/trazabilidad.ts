export interface ItemOperacion {
  productoNombre: string;
  productoCodigo: string;
  detalle: string;
  cantidad: number;
  loteVencimiento: Date | null;
  proceso: string;
  seccionNombre: string;
  idMovimiento: string;
  /** D6 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): solo en un CONSUMO que salió de un insumo SUSTITUTO — el nombre del
   * producto de la receta al que reemplazó. Null en todo lo demás (incluido un consumo de un hermano del mismo Insumo). */
  sustituyeANombre: string | null;
}

export interface DatosOperacion {
  idOperacion: string;
  fecha: Date;
  proceso: string;
  proveedorNombre: string | null;
  nroFactura: string | null;
  total: number;
  items: ItemOperacion[];
  /** Null = vigente. Hoy solo se anulan las ventas (ver anularVenta, server/actions/venta.ts), pero se informa para cualquier proceso. */
  anuladaEn: Date | null;
  anuladaPorEmail: string | null;
}

export interface OperacionEncontrada {
  idOperacion: string;
  fecha: Date;
  proceso: string;
  seccionNombre: string;
}
/**
 * El detalle con que se PRELLENA el Ajuste que corrige un movimiento (E0 de la corrección por ajuste, «Corregir este movimiento»): la referencia al original, para que el Kardex
 * diga qué corrige («Corrección del movimiento de COMPRA del 2026-11-03 · operación …»). El día lo pone quien llama (ya en hora argentina). Siempre cabe en el campo Detalle
 * (200 caracteres): si el texto se pasara, se recorta el final y se conserva el comienzo, que es lo que identifica el movimiento.
 */
export function detalleDeCorreccionDeMovimiento(args: { proceso: string; dia: string; idOperacion: string }, largoMaximo = 200): string {
  const texto = `Corrección del movimiento de ${args.proceso} del ${args.dia} · operación ${args.idOperacion}`;
  return texto.length <= largoMaximo ? texto : texto.slice(0, largoMaximo);
}

/** El enlace de «Corregir este movimiento»: abre el Ajuste con el movimiento a corregir (el servidor lee el original; la URL lleva solo su id). */
export function enlaceParaCorregirMovimiento(idMovimiento: string): string {
  return `/movimientos/ajuste?corrige=${encodeURIComponent(idMovimiento)}`;
}
