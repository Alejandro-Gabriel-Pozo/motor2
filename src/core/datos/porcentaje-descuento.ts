import { numeroDeEntrada, tieneALoSumoDecimales } from "./numero-tecleado";
import { aceptar, enMinuscula, rechazar, type ResultadoDato } from "./resultado";

/**
 * % de descuento de un `Cliente` (Task #14, docs/plan-clientes-descuento-2026-09-26.md, D1/D4/punto 6): un único porcentaje fijo por
 * cliente (no varía por categoría de producto — D1), que se APLICA sobre el precio de lista al cerrar la cuenta
 * (`precioConDescuento`, src/core/moneda.ts).
 */
export const DECIMALES_PORCENTAJE_DESCUENTO = 2;
/** D4: tope estricto, SIN límite específico más bajo — 100 % "regalaría" todo, así que no se admite. */
export const PORCENTAJE_DESCUENTO_MAXIMO = 100;

export interface OpcionesPorcentajeDescuento {
  /** Vacío → error "Falta …" en vez de `null`. Default: true (el % de un cliente siempre se carga). */
  obligatorio?: boolean;
}

/**
 * 0 ≤ % < 100, hasta {@link DECIMALES_PORCENTAJE_DESCUENTO} decimales — mismo patrón que `validarImporte`/`validarCantidad`
 * (`src/core/datos/`, `ResultadoDato`): parsea con el mismo parser es-AR estricto (`numeroDeEntrada`) que el resto de esta carpeta, así
 * un 0% explícito (cliente sin descuento hoy, pero que puede tenerlo mañana) es tan válido como cualquier otro.
 */
export function validarPorcentajeDescuento(valor: unknown, opciones: OpcionesPorcentajeDescuento = {}): ResultadoDato<number | null> {
  const { obligatorio = true } = opciones;
  const etiqueta = "El % de descuento";
  const numero = numeroDeEntrada(valor);
  if (!numero.ok) return rechazar("formato", `${etiqueta} no es un número válido.`);
  const n = numero.valor;
  if (n === null) return obligatorio ? rechazar("vacio", `Falta ${enMinuscula(etiqueta)}.`) : aceptar(null);
  if (n < 0) return rechazar("negativo", `${etiqueta} no puede ser negativo.`);
  if (n >= PORCENTAJE_DESCUENTO_MAXIMO) return rechazar("rango", `${etiqueta} tiene que ser menor que ${PORCENTAJE_DESCUENTO_MAXIMO} %.`);
  if (!tieneALoSumoDecimales(n, DECIMALES_PORCENTAJE_DESCUENTO)) return rechazar("decimales", `${etiqueta} admite como máximo ${DECIMALES_PORCENTAJE_DESCUENTO} decimales.`);
  return aceptar(n);
}
