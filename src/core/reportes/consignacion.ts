export interface FilaDebidoConsignante {
  /** null = liquidaciones de una MP esConsignacion sin proveedorConsignacionId cargado (dato incompleto) — no hay a quién asociarle un pago. */
  proveedorId: string | null;
  proveedor: string;
  liquidado: number;
  pagado: number;
  /** Saldo debido = liquidado - pagado. */
  importe: number;
}
export interface FilaStockSinVenderConsignacion {
  productoId: string;
  producto: string;
  codigo: string;
  proveedorConsignacionNombre: string | null;
  stockActual: number;
}
export interface ReporteConsignacion {
  debidoPorConsignante: FilaDebidoConsignante[];
  stockSinVender: FilaStockSinVenderConsignacion[];
}