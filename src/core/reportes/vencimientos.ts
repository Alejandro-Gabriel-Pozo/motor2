export interface FilaLoteProximoAVencer {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  seccionId: string;
  seccionNombre: string;
  loteVencimiento: Date;
  diasParaVencer: number;
  saldo: number;
  unidadStockNombre: string;
}

export interface FilaConciliacionVencimiento {
  productoNombre: string;
  seccionNombre: string;
  loteVencimiento: Date;
  cantidadDesaparecida: number;
  conteoAnteriorFecha: string;
  conteoActualFecha: string;
  ventasPeriodo: number;
  estado: "consistente" | "revisar";
}