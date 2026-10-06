export interface FilaPerdida {
  idMovimiento: string;
  idOperacion: string;
  fecha: Date;
  motivo: string;
  producto: string;
  productoId: string;
  cantidad: number;
  valor: number;
  sinPrecio: boolean;
}
export interface ReportePerdidas {
  dias: number;
  desde: Date;
  mermas: FilaPerdida[];
  consumos: FilaPerdida[];
  hayCostoIncompleto: boolean;
  totalMerma: number;
  totalConsumo: number;
}