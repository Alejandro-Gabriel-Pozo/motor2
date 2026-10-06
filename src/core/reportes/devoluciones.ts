import { type AccionFaltante } from "./accion-faltante";

export interface FilaDevolucionProducto {
  productoId: string;
  producto: string;
  cantidad: number;
  valor: number;
  sinPrecio: boolean;
  accionFaltante: AccionFaltante | null;
}
export interface FilaDevolucionProveedor {
  proveedor: string;
  cantidad: number;
  valor: number;
  sinPrecio: boolean;
  productos: FilaDevolucionProducto[];
}
export interface ReporteDevoluciones {
  dias: number;
  desde: Date;
  clientes: FilaDevolucionProducto[];
  proveedores: FilaDevolucionProveedor[];
  totalCliente: number;
  totalProveedor: number;
  hayCostoIncompleto: boolean;
}

export interface AccProducto {
  producto: string;
  seProduce: boolean;
  cantidad: number;
  valor: number;
  sinPrecio: boolean;
}