export interface FilaInsumoSinReceta {
  productoId: string;
  producto: string;
  codigo: string;
  insumoNombre: string | null;
  tieneProveedor: boolean;
}