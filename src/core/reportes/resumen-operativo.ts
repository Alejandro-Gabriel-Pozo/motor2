export interface ResumenFinanciero {
  desde: Date;
  hasta: Date;
  ventasTotal: number;
  margenTotal: number;
  margenPct: number | null;
  costoTotal: number;
  hayEstimados: boolean;
  hayCostoIncompleto: boolean;
  topProductos: { producto: string; importe: number }[];
  gastadoTotal: number;
  hayComprasSinPrecio: boolean;
  topProveedores: { proveedor: string; importe: number }[];
  /** Ver el docstring de MargenDelPeriodo.margenRealTotal en periodo.ts. */
  margenRealTotal: number | null;
  margenRealPct: number | null;
  /** «Real» incluye ventas cuyo costo se reconstruyó con el historial de compras (no se guardó al venderse). */
  margenRealReconstruido: boolean;
  /** Ver el docstring de MargenDelPeriodo.margenIPCTotal en periodo.ts. */
  margenIPCTotal: number | null;
  margenIPCPct: number | null;
  /** El ajuste por IPC incluye ventas de un mes que el INDEC todavía no publicó (provisorio). */
  margenIPCProvisorio: boolean;
  /** La serie del IPC está parada hace más del máximo previsto (5c): el ajuste no es «de hoy». Gana sobre `margenIPCProvisorio` en el rótulo. */
  ipcVencido: boolean;
  avisoVentas: string;
  avisoMargen: string;
  avisoMargenReal: string;
  avisoMargenIPC: string;
  avisoCompras: string;
}

export interface ResumenOperativo {
  stock: { totalItems: number; negativos: number; secciones: Record<string, number> };
  alertas: { total: number; criticos: number; bajos: number };
  movimientos: { total: number; porProceso: Record<string, number> };
  topStockBajo: { producto: string; saldo: number; seccion: string }[];
  financiero: ResumenFinanciero;
}