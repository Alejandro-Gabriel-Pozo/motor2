import "server-only";
import type { Db } from "@/lib/db-tipos";
import { productoTieneRecetas } from "@/server/lecturas/catalogo/recetas-vigentes";

/**
 * Lo que el diálogo «Duplicar» de la ficha del producto muestra del original antes de confirmar (etapa E4 de `docs/diseno-duplicar-producto-2026-11-12.md`): si tiene receta (de la central o propia de alguna
 * sucursal) y cuántos grupos y opciones activos admite, con cuántas opciones llevan precio. Es lo que la pantalla dice que se va a copiar; lo que se copia de verdad lo decide el caso de uso al confirmar. Solo la pide la
 * ficha, así que es una consulta. Sin guarda de permiso adentro: la página la pone antes.
 */
export interface ResumenParaDuplicar {
  tieneReceta: boolean;
  /** `null` si el producto no admite nada (un grupo activo en el producto y no archivado en la biblioteca cuenta; uno archivado, no). */
  opciones: { grupos: number; opciones: number; conPrecio: number } | null;
}

export async function leerResumenParaDuplicar(db: Db, productoId: string): Promise<ResumenParaDuplicar> {
  const [tieneReceta, grupos, filas] = await Promise.all([
    productoTieneRecetas(db, productoId),
    db.productoAdmiteGrupo.count({ where: { productoId, activo: true, grupo: { activo: true } } }),
    db.productoAdmiteOpcion.findMany({
      where: { productoId, activo: true, opcion: { activa: true, grupo: { activo: true } } },
      select: { precioAbsoluto: true, tipoDeDiferencia: true },
    }),
  ]);
  return {
    tieneReceta,
    opciones: grupos === 0 ? null : { grupos, opciones: filas.length, conPrecio: filas.filter((f) => f.precioAbsoluto !== null || f.tipoDeDiferencia !== null).length },
  };
}
