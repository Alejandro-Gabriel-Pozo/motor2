export interface FilaPvSinVenta {
  productoId: string;
  producto: string;
  codigo: string;
}
export interface FilaInsumoConRecetaSinProveedor {
  productoId: string;
  producto: string;
  codigo: string;
  insumoNombre: string | null;
}
export interface ProblemaUnidadMezclada {
  insumoId: string;
  insumo: string;
  unidades: string[];
  productos: { nombre: string; unidad: string }[];
}

export interface ReporteHuecosCatalogo {
  pvSinVentaNunca: FilaPvSinVenta[];
  insumosConRecetaSinProveedor: FilaInsumoConRecetaSinProveedor[];
}