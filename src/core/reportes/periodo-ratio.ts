export interface RatioGastoVentas {
  /** Compras de comida y bebida ÷ Ventas (sin packaging ni limpieza si el grupo «No comestibles» existe). */
  porcentaje: number | null;
  porcentajePeriodoAnterior: number | null;
  /** Existe el grupo «No comestibles»: el ratio ya viene sin esas compras. */
  excluyeNoComestibles: boolean;
  /** Lo que se compró de no comestibles en el período y quedó fuera del ratio. */
  gastoNoComestibles: number;
  aviso: string;
}