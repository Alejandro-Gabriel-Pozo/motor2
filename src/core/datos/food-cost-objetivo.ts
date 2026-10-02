import { numeroDeEntrada, tieneALoSumoDecimales } from "./numero-tecleado";
import { aceptar, rechazar, type ResultadoDato } from "./resultado";

/** Decimales que admite el food cost objetivo (coincide con `DECIMAL(5,2)` de `MargenObjetivo.foodCostObjetivoPct`). */
export const DECIMALES_FOOD_COST_OBJETIVO = 2;

/**
 * Food cost objetivo tecleado: un % estrictamente entre 0 y 100, hasta {@link DECIMALES_FOOD_COST_OBJETIVO} decimales. Vacío es válido y da
 * `null`: significa «sin objetivo propio» (la categoría vuelve al de la empresa; la empresa, al de por defecto). 0 % y 100 % no tienen sentido
 * (el CHECK de la base los rechaza igual).
 */
export function validarFoodCostObjetivo(valor: unknown): ResultadoDato<number | null> {
  const etiqueta = "El food cost objetivo";
  const numero = numeroDeEntrada(valor);
  if (!numero.ok) return rechazar("formato", `${etiqueta} no es un número válido.`);
  const n = numero.valor;
  if (n === null) return aceptar(null);
  if (n <= 0) return rechazar("rango", `${etiqueta} tiene que ser mayor que 0 %.`);
  if (n >= 100) return rechazar("rango", `${etiqueta} tiene que ser menor que 100 %.`);
  if (!tieneALoSumoDecimales(n, DECIMALES_FOOD_COST_OBJETIVO)) return rechazar("decimales", `${etiqueta} admite como máximo ${DECIMALES_FOOD_COST_OBJETIVO} decimales.`);
  return aceptar(n);
}
