import { cocienteRedondeadoArriba } from "@/core/moneda";

/**
 * Food cost objetivo: la porción del precio de venta (neto, sin IVA por ahora) que puede irse en comida y bebida. Se mide sobre el costo SIN
 * packaging ni limpieza (grupo «No comestibles»), igual que `foodCostPct`. Es el único lugar donde vive el número: es el valor POR DEFECTO, el
 * que rige mientras la empresa no cargue uno propio (ni uno para la categoría del producto): ver `resolverObjetivoFoodCost`.
 */
export const FOOD_COST_OBJETIVO_PCT = 40;

/**
 * Los objetivos cargados de una empresa: el propio de la empresa (`null` = no cargó uno) y el de cada categoría que tiene el suyo
 * (`MargenObjetivo`; ver `margen-objetivo-consulta.ts`).
 */
export interface ObjetivosDeMargen {
  empresaPct: number | null;
  porCategoria: ReadonlyMap<string, number>;
}

/**
 * El objetivo que rige para un producto: el de SU categoría, si la categoría tiene uno; si no el de la empresa; y si tampoco, la constante
 * {@link FOOD_COST_OBJETIVO_PCT}. Sin `objetivos` (quien calcula no los cargó) rige la constante.
 */
export function resolverObjetivoFoodCost(objetivos: ObjetivosDeMargen | undefined, categoriaId: string | null | undefined): number {
  if (!objetivos) return FOOD_COST_OBJETIVO_PCT;
  const deCategoria = categoriaId ? objetivos.porCategoria.get(categoriaId) : undefined;
  return deCategoria ?? objetivos.empresaPct ?? FOOD_COST_OBJETIVO_PCT;
}

/** ¿El costo de comida y bebida supera el objetivo sobre el precio? Estricto: justo en el objetivo no cuenta como alto. */
export function superaFoodCostObjetivo(costoComida: number, precio: number, objetivoPct: number = FOOD_COST_OBJETIVO_PCT): boolean {
  return costoComida * 100 > objetivoPct * precio;
}

/**
 * Precio de venta MÍNIMO con el que el costo de comida y bebida no pasa del objetivo: la cuenta exacta redondeada al centavo HACIA ARRIBA, así
 * que el food cost con ese precio nunca queda sobre el objetivo (decisión del dueño, 2026-10-01). `null` si no hay costo de comida conocido o
 * el objetivo no está entre 0 y 100.
 */
export function precioParaObjetivo(costoComida: number | null, objetivoPct: number = FOOD_COST_OBJETIVO_PCT): number | null {
  if (costoComida === null || !(costoComida > 0)) return null;
  if (!(objetivoPct > 0 && objetivoPct < 100)) return null;
  return cocienteRedondeadoArriba(costoComida, objetivoPct, 100);
}
