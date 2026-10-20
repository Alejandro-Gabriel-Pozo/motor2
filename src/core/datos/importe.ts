import { redondearMoneda } from "@/core/moneda";
import { numeroDeEntrada, tieneALoSumoDecimales } from "./numero-tecleado";
import { aceptar, enMinuscula, rechazar, type ResultadoDato } from "./resultado";

/**
 * Importes de ENTRADA (precio de compra, precio local…): lo que se teclea o llega a una Server Action. "Redondeo uniforme" para la
 * entrada significa RECHAZAR más de 2 decimales, no redondear en silencio; `redondearMoneda` (src/core/moneda.ts)
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

/**
 * Los CENTAVOS (entero) de un importe de dinero que ya tiene a lo sumo 2 decimales (de una columna `Decimal(14,2)` pasada a `number`, o validado con
 * `validarImporte`). Redondea primero en decimal exacto (`redondearMoneda`) y después pasa a entero: así el ruido de la coma flotante (`0.1 + 0.2`) no
 * cambia el resultado. Es para COMPARAR dinero, nunca para hacer cuentas.
 */
export function centavosDeImporte(n: number): number {
  return Math.round(redondearMoneda(n) * 100);
}

/**
 * ¿Dos importes son el MISMO dinero, al centavo? La regla única del control del valor visto (ola «precio y carta», Fase 2): lo que vio la pantalla
 * contra lo que hay en la base, sin comparar `number` con `===` (`0.1 + 0.2 !== 0.3`). `null` es «sin importe» (un precio local que no hay): solo es
 * igual a otro `null`. Un valor no finito (`NaN`, `±Infinity`) no es igual a nada.
 */
export function mismosCentavos(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return centavosDeImporte(a) === centavosDeImporte(b);
}
