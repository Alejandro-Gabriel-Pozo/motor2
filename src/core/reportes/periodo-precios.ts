import { type AntiguedadSerieIPC } from "./indices-economicos";

export interface FilaPrecioInsumo {
  insumo: string;
  grupo: string | null;
  /** $ por unidad de stock, promedio ponderado por cantidad de las compras del período. */
  precioUnitarioPromedio: number;
  cantidadComprada: number;
  /** Precio unitario de la última Compra de este insumo ANTES de que empezara el período — null si nunca se compró antes (primera vez) o esa compra no tenía precio real. */
  precioUnitarioAnterior: number | null;
  deltaPct: number | null;
  /** (precioUnitarioPromedio - precioUnitarioAnterior) × cantidadComprada — lo que realmente costó (o ahorró) el cambio de precio, a la cantidad que efectivamente se compró. Esto es lo que ordena la lista, no el %. */
  deltaImpacto: number | null;
  /** |deltaPct| pasa un umbral poco creíble para una suba real de precio — más probable un error de carga (unidad/presentación mal tipeada) que una suba genuina. Se muestra igual, marcado, en vez de ocultarlo o de tratarlo como un hecho. */
  sospechoso: boolean;
}

export interface ComparativaPreciosDelPeriodo {
  /** Variación agregada ponderada por $ comprado de `tendenciaPrecios` (excluye insumos `sospechoso`: distorsionarían el agregado con lo que probablemente es un error de carga). */
  variacionInsumosPct: number | null;
  /** Variación de `Producto.precioVenta` registrada en RegistroAuditoria durante el período, ponderada por lo facturado en el período de esos mismos productos. */
  variacionCartaPropiaPct: number | null;
  cantidadProductosConCambioCarta: number;
  /** IPC GBA Nivel General (INDEC) del mismo período — contexto de inflación general, no del rubro. */
  variacionIPCPct: number | null;
  aviso: string;
  avisoCarta: string;
  avisoIPC: string;
  /** Cuán vieja es la serie del IPC (5c): con `vencida`, el aviso deja de culpar al INDEC por un atraso que es de la sincronización. */
  antiguedadIPC: AntiguedadSerieIPC;
}