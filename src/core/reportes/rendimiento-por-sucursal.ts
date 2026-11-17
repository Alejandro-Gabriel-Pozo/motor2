import type { BaseDeCantidad } from "@/core/catalogo/public";

export interface ValorPorSucursal {
  /** Efectivo (rendimientoEfectivo), en la BASE de la línea (`FilaComparacionRendimiento.baseDeCantidad`, M3d): neto en una receta neta, bruto en una bruta. */
  cantidad: number;
  mermaPorcentaje: number;
  /** BRUTO = cantidad × (1 + merma/100) en una receta neta, la `cantidad` tal cual en una bruta (M3d) — la métrica que se COMPARA entre sucursales (D8: comparar solo el neto engaña si dos sucursales calibraron mermas distintas). */
  bruto: number;
  calibrado: boolean;
  /** true si esta sucursal tiene RECETA PROPIA habilitada para el plato: la línea central no rige ahí (ni sus calibraciones), así que los valores de esta celda son los centrales sin aplicar y la pantalla lo avisa en vez de compararlos. */
  recetaPropia: boolean;
  /** % de desvío del bruto de ESTA sucursal contra el bruto CENTRAL — decide el ámbar (desvioEsNotable). `null` si el central es 0. */
  desviacionPorcentaje: number | null;
}

export interface FilaComparacionRendimiento {
  productoId: string;
  productoNombre: string;
  recetaIngredienteId: string;
  /** M3d: la base (NETA/BRUTA) de la versión central a la que pertenece la línea; `central.cantidad` y `porSucursal[].cantidad` están escritas en ella (la calibración hereda la base de la línea). */
  baseDeCantidad: BaseDeCantidad;
  insumoProductoId: string;
  insumoNombre: string;
  unidadNombre: string;
  central: { cantidad: number; mermaPorcentaje: number; bruto: number };
  /** Una entrada por sucursal pedida. */
  porSucursal: Map<string, ValorPorSucursal>;
  /** true si ALGUNA sucursal calibró esta línea — filtro por defecto de la pantalla (D8). */
  algunaCalibrada: boolean;
}

export interface FiltroComparacionRendimiento {
  productoId?: string;
  /** false (default de la pantalla): solo líneas con alguna calibración visible. true (`?todas=1`): todas. */
  todas?: boolean;
}
