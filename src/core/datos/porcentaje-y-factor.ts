import { contextoDeCantidad, numeroDeEntrada, rechazoDeNumeroDeEntrada, tieneALoSumoDecimales } from "./numero-tecleado";
import { aceptar, enMinuscula, rechazar, type ResultadoDato } from "./resultado";

/**
 * El PORCENTAJE de una diferencia de precio y el FACTOR DE ESCALA de una medida, tal como llegan a una Server Action (GO-2a, el catálogo de opciones de venta). Mismo patrón que
 * `validarImporte` y `validarPorcentajeDescuento`: el parser es-AR estricto (`numeroDeEntrada`), y lo que trae más decimales de los que guarda la columna se RECHAZA, no se redondea
 * (la base redondea sin avisar: `numeric(7,4)` guarda 1,00005 como 1,0001).
 *
 * Los bordes son los de los CHECK de GO-1 (`VersionDeOpcion_porcentaje_chk`, `ProductoAdmiteOpcion_porcentaje_chk`, `VersionDeOpcion_factor_chk`):
 * - porcentaje `DECIMAL(7,4)`: mayor que -100 (un -100 % dejaría el precio en 0) y hasta 999,9999;
 * - factor `DECIMAL(8,4)`: mayor que 0 y hasta 10.
 */
const DECIMALES_PORCENTAJE_DE_DIFERENCIA = 4;
const PORCENTAJE_DE_DIFERENCIA_MINIMO_EXCLUIDO = -100;
const PORCENTAJE_DE_DIFERENCIA_MAXIMO = 999.9999;
const DECIMALES_FACTOR_DE_ESCALA = 4;
const FACTOR_DE_ESCALA_TOPE = 10;

export interface OpcionesDeNumeroAcotado {
  /** Sujeto del mensaje, en mayúscula ("El porcentaje", "El factor de escala"). */
  etiqueta: string;
  /** Vacío → error "Falta …" en vez de `null`. Default: true. */
  obligatorio?: boolean;
}

/** -100 < p ≤ 999,9999, hasta 4 decimales. */
export function validarPorcentajeDeDiferencia(valor: unknown, opciones: OpcionesDeNumeroAcotado): ResultadoDato<number | null> {
  const { etiqueta, obligatorio = true } = opciones;
  const numero = numeroDeEntrada(valor, contextoDeCantidad(DECIMALES_PORCENTAJE_DE_DIFERENCIA));
  if (!numero.ok) return rechazoDeNumeroDeEntrada(numero, etiqueta, `${etiqueta} admite como máximo ${DECIMALES_PORCENTAJE_DE_DIFERENCIA} decimales.`, valor);
  const n = numero.valor;
  if (n === null) return obligatorio ? rechazar("vacio", `Falta ${enMinuscula(etiqueta)}.`) : aceptar(null);
  if (n <= PORCENTAJE_DE_DIFERENCIA_MINIMO_EXCLUIDO || n > PORCENTAJE_DE_DIFERENCIA_MAXIMO) {
    return rechazar("rango", `${etiqueta} tiene que ser mayor que ${PORCENTAJE_DE_DIFERENCIA_MINIMO_EXCLUIDO} % y hasta 999,9999 %.`);
  }
  if (!tieneALoSumoDecimales(n, DECIMALES_PORCENTAJE_DE_DIFERENCIA)) return rechazar("decimales", `${etiqueta} admite como máximo ${DECIMALES_PORCENTAJE_DE_DIFERENCIA} decimales.`);
  return aceptar(n);
}

/** 0 < f ≤ 10, hasta 4 decimales. */
export function validarFactorDeEscala(valor: unknown, opciones: OpcionesDeNumeroAcotado): ResultadoDato<number | null> {
  const { etiqueta, obligatorio = true } = opciones;
  const numero = numeroDeEntrada(valor, contextoDeCantidad(DECIMALES_FACTOR_DE_ESCALA));
  if (!numero.ok) return rechazoDeNumeroDeEntrada(numero, etiqueta, `${etiqueta} admite como máximo ${DECIMALES_FACTOR_DE_ESCALA} decimales.`, valor);
  const n = numero.valor;
  if (n === null) return obligatorio ? rechazar("vacio", `Falta ${enMinuscula(etiqueta)}.`) : aceptar(null);
  if (n <= 0) return rechazar(n === 0 ? "cero" : "negativo", `${etiqueta} tiene que ser mayor que cero.`);
  if (n > FACTOR_DE_ESCALA_TOPE) return rechazar("rango", `${etiqueta} no puede superar ${FACTOR_DE_ESCALA_TOPE}.`);
  if (!tieneALoSumoDecimales(n, DECIMALES_FACTOR_DE_ESCALA)) return rechazar("decimales", `${etiqueta} admite como máximo ${DECIMALES_FACTOR_DE_ESCALA} decimales.`);
  return aceptar(n);
}
