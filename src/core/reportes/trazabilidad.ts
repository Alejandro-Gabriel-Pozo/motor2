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