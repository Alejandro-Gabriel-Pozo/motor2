import "server-only";
import { prisma, type Db } from "@/lib/db";
import { whereDisponibleEnAlguna } from "@/core/catalogo/public-servidor";

/**
 * Lecturas de Catálogo › Recetas para los Server Components (Task #41, Fases D3 y D4). Mismo contrato que
 * `server/consultas/catalogo/productos.ts` (ver su cabecera): `server-only`, sin guarda de permiso adentro (la página la hace
 * antes), `db: Db = prisma` al final y devuelve EXACTAMENTE lo que devolvía la consulta Prisma que reemplaza.
 *
 * El producto suelto del historial (`/catalogo/recetas/[productoId]/historial`) y del editor (`/catalogo/recetas/[productoId]`)
 * NO vive acá: los dos reusan `obtenerProductoPorId` de `productos.ts`. La receta vigente del editor tampoco: sigue siendo
 * `obtenerRecetaVigente` (server/actions/catalogo/recetas.ts).
 */

/**
 * Lista de recetas YA armadas (`/catalogo/recetas`): los productos disponibles en alguna sucursal que tienen al menos una
 * versión de receta, por nombre, cada uno con SOLO su última versión (`recetaVersiones[0]`, la de `version` más alta) y el
 * conteo de ingredientes de esa versión (`_count.ingredientes`). Lectura CENTRAL (lista de lectores-de-receta.test.ts): no
 * lee cantidad ni merma, así que no resuelve nada por sucursal.
 */
export async function listarProductosConReceta(db: Db = prisma) {
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

/**
 * Materias primas para el desplegable "Agregar ingrediente" del editor (`/catalogo/recetas/[productoId]`, Task #41 D4): todas
 * las MP disponibles en alguna sucursal, por nombre, con sus escalares (sin relaciones). Es la misma regla que valida
 * `validarIngredientes` al guardar (disponible EN ALGUNA, nunca en todas).
 */
export async function listarMpDisponiblesEnAlguna(db: Db = prisma) {
  return db.producto.findMany({ where: { tipo: "MP", ...whereDisponibleEnAlguna() }, orderBy: { nombre: "asc" } });
}

/**
 * Opciones del desplegable "Sustituto N" de UN ingrediente del editor (Task #41 D4; docs/plan-sustitucion-insumos-receta-2026-09-26.md):
 * los insumos activos, por nombre, que tengan alguna MP disponible en alguna sucursal con la MISMA unidad de stock que la
 * unidad del ingrediente — menos el insumo del propio ingrediente. Solo `{ id, nombre }`.
 *
 * `insumoIdExcluido` es el `insumoId` (nullable) de la MP del ingrediente: con `null` no se excluye ninguno (`not: undefined`
 * = sin filtro por id), igual que el `?? undefined` que tenía la página. La página la llama UNA vez por ingrediente (N+1
 * conocido, fuera del alcance de D4).
 */
export async function listarOpcionesDeSustituto(ing: { insumoIdExcluido: string | null; unidadId: string }, db: Db = prisma) {
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
 * Calibraciones por sucursal de las líneas de la receta vigente (nota "Calibrado en N sucursal(es)" del editor, Task #41 D4;
 * docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 7): las filas de `RendimientoLocalIngrediente` de esas
 * líneas que pisan algo (cantidad o merma no nulas), cada una con el nombre de su sucursal. UNA consulta por lotes. Lee
 * solo los overrides, no la receta: no resuelve ningún rendimiento efectivo.
 */
export async function listarCalibracionesDeIngredientes(recetaIngredienteIds: string[], db: Db = prisma) {
  return db.rendimientoLocalIngrediente.findMany({
    where: { recetaIngredienteId: { in: recetaIngredienteIds }, OR: [{ cantidad: { not: null } }, { mermaPorcentaje: { not: null } }] },
    include: { sucursal: { select: { nombre: true } } },
  });
}
