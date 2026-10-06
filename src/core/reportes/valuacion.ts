export interface FilaValuacionInventario {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  insumoNombre: string | null;
  unidadStockNombre: string;
  saldo: number;
  costoUnitario: number | null;
  valor: number | null;
  proveedorNombre: string | null;
  sinCosto: boolean;
}

export interface ReporteValuacionInventario {
  filas: FilaValuacionInventario[];
  totalValorizado: number;
  cantidadSinCosto: number;
}