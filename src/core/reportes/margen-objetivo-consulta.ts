import type { Db } from "./comun";
import type { ObjetivosDeMargen } from "./margen-objetivo";

/** Los objetivos de food cost cargados en la empresa activa (el `db` ya viene acotado a ella por RLS). Una sola consulta: la tabla es chica. */
export async function cargarObjetivosDeMargen(db: Db): Promise<ObjetivosDeMargen> {
  const filas = await db.margenObjetivo.findMany({ select: { categoriaId: true, foodCostObjetivoPct: true } });
  let empresaPct: number | null = null;
  const porCategoria = new Map<string, number>();
  for (const f of filas) {
    if (f.categoriaId === null) empresaPct = Number(f.foodCostObjetivoPct);
    else porCategoria.set(f.categoriaId, Number(f.foodCostObjetivoPct));
  }
  return { empresaPct, porCategoria };
}
