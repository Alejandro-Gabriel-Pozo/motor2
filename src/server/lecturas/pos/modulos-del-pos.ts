import "server-only";
import { modulosEfectivosDeEmpresa } from "@/server/acceso/modulos-de-empresa";
import type { Db } from "@/lib/db-tipos";

/**
 * Lo CONTRATADO que el POS consume además de Salón (S-22 / D2 del dueño, tanda T10 del endurecimiento de seguridad): el POS pertenece al módulo Salón —el gate de
 * cada acción `pos_*` ya lo exige—, pero el selector de «agregar al pedido» y la validación de cada promo leen DATOS de otros dos módulos, y esos no pasan por el
 * gate de ninguna acción:
 *  - `carta`: la estructura del selector (secciones, géneros, ítems agrupados). Sin Carta el POS vende con los productos sueltos, sin carta: lista plana;
 *  - `promociones`: las promos armables. Sin Promociones el POS no las ofrece ni las acepta.
 *
 * Es una pregunta sobre el REGISTRO DE MÓDULOS de la empresa, así que la contesta el único lector de ese registro (`server/acceso/modulos-de-empresa.ts`, que el
 * guard y el menú comparten): acá no se vuelve a calcular la clausura. `promociones` requiere `carta` en el catálogo (ADR-011): con Promociones prendido, Carta
 * también lo está; nunca al revés.
 */
export interface ModulosDelPos {
  carta: boolean;
  promociones: boolean;
}

/** Sin nada: lo que se devuelve cuando no hay a quién preguntarle (una sucursal que no existe). Fallo cerrado. */
const SIN_MODULOS: ModulosDelPos = { carta: false, promociones: false };

export async function modulosDelPosDeEmpresa(empresaId: string, db: Db): Promise<ModulosDelPos> {
  const efectivos = await modulosEfectivosDeEmpresa(empresaId, db);
  return { carta: efectivos.has("carta"), promociones: efectivos.has("promociones") };
}

/** Como `modulosDelPosDeEmpresa`, desde la sucursal que se lee (la empresa que la tiene es la que contrató los módulos). Una sucursal que no existe no tiene ninguno. */
export async function modulosDelPosDeSucursal(sucursalId: string, db: Db): Promise<ModulosDelPos> {
  const sucursal = await db.sucursal.findUnique({ where: { id: sucursalId }, select: { empresaId: true } });
  return sucursal ? modulosDelPosDeEmpresa(sucursal.empresaId, db) : SIN_MODULOS;
}
