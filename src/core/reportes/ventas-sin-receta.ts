export interface FilaVentaSinReceta {
  productoId: string;
  producto: string;
  codigo: string;
  cantidadVentasSinReceta: number;
  primeraFecha: Date;
  ultimaFecha: Date;
}