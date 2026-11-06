export interface FilaResumenConsolidado {
  sucursalId: string;
  sucursalNombre: string;
  ventasTotal: number;
  /** Ventas con importe $0 («sin dato») de la sucursal: fuera de `ventasTotal`. */
  ventasSinDato: number;
  margenTotal: number;
  gastadoTotal: number;
  alertasCriticas: number;
  alertasBajas: number;
}