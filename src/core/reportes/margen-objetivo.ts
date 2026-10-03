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

/** Lo mínimo que hace falta de una fila del reporte de costos para resumir qué platos están fuera del objetivo (sin importar `costos.ts`, que importa este archivo). */
export interface FilaParaResumenDeObjetivo {
  productoNombre: string;
  estado: string;
  foodCostPct: number | null;
  objetivoFoodCostPct: number;
}

export interface ResumenFueraDeObjetivo {
  cantidad: number;
  /** El plato más lejos de su objetivo, en puntos porcentuales de food cost. */
  peor: { nombre: string; foodCostPct: number; objetivoPct: number };
}

/** ¿La empresa cargó algún objetivo (el propio o el de alguna categoría)? Sin ninguno rige el de por defecto y el reporte por período no avisa nada. */
export function hayObjetivosCargados(objetivos: ObjetivosDeMargen): boolean {
  return objetivos.empresaPct !== null || objetivos.porCategoria.size > 0;
}

/**
 * Los platos con el food cost sobre su objetivo: los marcados «Food cost alto» en Costos, más los de margen negativo cuyo food cost también
 * pasa del objetivo (el estado de margen negativo gana sobre el de food cost alto, pero el plato sigue estando fuera). `null` si no hay ninguno.
 * Desempata por nombre para que el resultado no dependa del orden de las filas.
 */
export function resumirFueraDeObjetivo(filas: readonly FilaParaResumenDeObjetivo[]): ResumenFueraDeObjetivo | null {
  const fuera = filas.filter((f) => f.estado === "FOOD_COST_ALTO" || (f.estado === "MARGEN_NEGATIVO" && f.foodCostPct !== null && f.foodCostPct > f.objetivoFoodCostPct));
  if (fuera.length === 0) return null;
  const distancia = (f: FilaParaResumenDeObjetivo) => (f.foodCostPct ?? 0) - f.objetivoFoodCostPct;
  const peor = [...fuera].sort((a, b) => distancia(b) - distancia(a) || a.productoNombre.localeCompare(b.productoNombre))[0]!;
  return { cantidad: fuera.length, peor: { nombre: peor.productoNombre, foodCostPct: peor.foodCostPct ?? 0, objetivoPct: peor.objetivoFoodCostPct } };
}
