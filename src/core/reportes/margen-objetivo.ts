import { redondearMoneda } from "@/core/moneda";

/**
 * Food cost objetivo: la porción del precio de venta (neto, sin IVA por ahora) que puede irse en comida y bebida. Se mide sobre el costo SIN
 * packaging ni limpieza (grupo «No comestibles»), igual que `foodCostPct`. Es el único lugar donde vive el número: hoy es fijo para toda la
 * empresa; cuando sea configurable, esta constante pasa a ser el valor por defecto.
 */
export const FOOD_COST_OBJETIVO_PCT = 40;

/** ¿El costo de comida y bebida supera el objetivo sobre el precio? Estricto: justo en el objetivo no cuenta como alto. */
export function superaFoodCostObjetivo(costoComida: number, precio: number, objetivoPct: number = FOOD_COST_OBJETIVO_PCT): boolean {
  return costoComida * 100 > objetivoPct * precio;
}

/** Precio de venta con el que el costo de comida y bebida cae justo en el objetivo. `null` si no hay costo de comida conocido o el objetivo no está entre 0 y 100. */
export function precioParaObjetivo(costoComida: number | null, objetivoPct: number = FOOD_COST_OBJETIVO_PCT): number | null {
  if (costoComida === null || !(costoComida > 0)) return null;
  if (!(objetivoPct > 0 && objetivoPct < 100)) return null;
  return redondearMoneda((costoComida * 100) / objetivoPct);
}
