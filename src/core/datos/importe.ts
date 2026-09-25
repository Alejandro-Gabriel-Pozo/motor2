import { numeroDeEntrada, tieneALoSumoDecimales } from "./numero-tecleado";
import { aceptar, enMinuscula, rechazar, type ResultadoDato } from "./resultado";

/**
 * Importes de ENTRADA (precio de compra, precio local…): lo que se teclea o llega a una Server Action. "Redondeo uniforme" para la
 * entrada significa RECHAZAR más de 2 decimales, no redondear en silencio; `redondearMoneda` (src/core/movimientos/transiciones.ts)
 * sigue siendo para los montos CALCULADOS.
 */
export const DECIMALES_IMPORTE = 2;
/** Tope de las columnas `Decimal(14,2)` (mismo criterio que validarPrecioCarta): el importe tiene que ser menor. */
export const IMPORTE_MAXIMO = 1e12;

export interface OpcionesImporte {
  /** Sujeto del mensaje, en mayúscula y masculino ("El precio", `El precio de "Harina"`): "El precio no puede ser negativo." */
  etiqueta: string;
  /** Vacío → error "Falta …" en vez de `null`. Default: false. */
  obligatorio?: boolean;
  /** Default: false. */
  permitirNegativo?: boolean;
  /** Default: true (una compra o un precio en 0 son válidos). */
  permitirCero?: boolean;
}

export function validarImporte(valor: unknown, opciones: OpcionesImporte): ResultadoDato<number | null> {
  const { etiqueta, obligatorio = false, permitirNegativo = false, permitirCero = true } = opciones;
  const numero = numeroDeEntrada(valor);
  if (!numero.ok) return rechazar("formato", `${etiqueta} no es un número válido.`);
  const n = numero.valor;
  if (n === null) return obligatorio ? rechazar("vacio", `Falta ${enMinuscula(etiqueta)}.`) : aceptar(null);
  if (n < 0 && !permitirNegativo) return rechazar("negativo", `${etiqueta} no puede ser negativo.`);
  if (n === 0 && !permitirCero) return rechazar("cero", `${etiqueta} tiene que ser mayor que cero.`);
  if (Math.abs(n) >= IMPORTE_MAXIMO) return rechazar("rango", `${etiqueta} es demasiado grande.`);
  if (!tieneALoSumoDecimales(n, DECIMALES_IMPORTE)) return rechazar("decimales", `${etiqueta} admite como máximo ${DECIMALES_IMPORTE} decimales.`);
  return aceptar(n);
}
