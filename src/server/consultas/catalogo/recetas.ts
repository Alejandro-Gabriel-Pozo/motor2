import "server-only";
import { prisma } from "@/lib/db";
import type { Db } from "@/lib/db-tipos";
import { whereDisponibleEnAlguna } from "@/core/catalogo/public-servidor";

/**
 * Lecturas de Catálogo › Recetas para los Server Components (Task #41, Fase D3/D4). Mismo contrato que
 * `server/consultas/catalogo/productos.ts` (ver su cabecera): `server-only`, sin guarda de permiso adentro (la página la hace
 * antes), `db: Db` al final y devuelve EXACTAMENTE lo que devolvía la consulta Prisma que reemplaza.
 *
 * El producto suelto del historial (`/catalogo/recetas/[productoId]/historial`) NO vive acá: reusa `obtenerProductoPorId`
 * de `productos.ts` (el editor, `/catalogo/recetas/[productoId]`, también).
 */

/**
 * Lista de recetas YA armadas (`/catalogo/recetas`): los productos disponibles en alguna sucursal que tienen al menos una
 * versión de receta, por nombre, cada uno con SOLO su última versión (`recetaVersiones[0]`, la de `version` más alta) y el
 * conteo de ingredientes de esa versión (`_count.ingredientes`). Lectura CENTRAL (lista de lectores-de-receta.test.ts): no
 * lee cantidad ni merma, así que no resuelve nada por sucursal.
 */
export async function listarProductosConReceta(db: Db) {
  return db.producto.findMany({
    where: { ...whereDisponibleEnAlguna(), recetaVersiones: { some: {} } },
    orderBy: { nombre: "asc" },
    include: {
      recetaVersiones: {
        orderBy: { version: "desc" },
        take: 1,
        include: { _count: { select: { ingredientes: true } } },
      },
    },
  });
}

/** Editor de receta (`/catalogo/recetas/[productoId]`): las materias primas disponibles en alguna sucursal, para el selector de "Agregar ingrediente". */
export async function listarMpDisponiblesEnAlguna(db: Db) {
  return db.producto.findMany({ where: { tipo: "MP", ...whereDisponibleEnAlguna() }, orderBy: { nombre: "asc" } });
}

/**
 * Editor de receta: opciones de sustituto para UN ingrediente puntual — insumos activos que tengan algún producto MP con
 * esa misma unidad de stock, disponible en alguna sucursal, excluyendo el insumo del propio ingrediente.
 */
export async function listarOpcionesDeSustituto(
  ing: { insumoIdExcluido: string | null; unidadId: string },
  db: Db,
) {
  return db.insumo.findMany({
    where: {
      activo: true,
      id: { not: ing.insumoIdExcluido ?? undefined },
      productos: { some: { tipo: "MP", unidadStockId: ing.unidadId, ...whereDisponibleEnAlguna() } },
    },
    orderBy: { nombre: "asc" },
    select: { id: true, nombre: true },
  });
}

/**
 * Editor de receta: notas "Calibrado en N sucursal(es)" por ingrediente — UNA sola consulta por lotes (no una por
 * ingrediente) a `RendimientoLocalIngrediente`, para los ingredientes de la receta vigente que se pasen.
 */
export async function listarCalibracionesDeIngredientes(recetaIngredienteIds: string[], db: Db) {
  return db.rendimientoLocalIngrediente.findMany({
    where: { recetaIngredienteId: { in: recetaIngredienteIds }, OR: [{ cantidad: { not: null } }, { mermaPorcentaje: { not: null } }] },
    include: { sucursal: { select: { nombre: true } } },
  });
}
