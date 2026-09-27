import "server-only";
import { prisma, type Db } from "@/lib/db";
import {
  compararRendimientosPorSucursal,
  type FiltroComparacionRendimiento,
  type FilaComparacionRendimiento,
} from "@/core/reportes/rendimiento-por-sucursal";

/**
 * Lecturas de Reportes › Rendimiento por sucursal para los Server Components (Task #41, Fase D7). Mismo contrato que
 * `src/server/consultas/catalogo/productos.ts` (piloto D1): `server-only`, sin `"use server"`, sin guarda de permiso adentro
 * (la página hace `requierePermisoVer(..., "ver_reportes_dinero")` antes), último parámetro `db: Db = prisma`.
 *
 * Envoltorio fino a propósito: la consulta y el armado viven en `compararRendimientosPorSucursal` (`core/reportes`), que
 * recibe `db` OBLIGATORIO porque no importa el valor `@/lib/db`. Lo único que agrega esta capa es el default `db = prisma`,
 * para que la página deje de importar `@/lib/db` (regla `ui-sin-prisma`). Devuelve exactamente lo que devuelve la función
 * de core — incluido el `Map` de `porSucursal`, que la página aplana antes de mandarlo al cliente.
 */

/** Filas de comparación del rendimiento calibrado de cada línea de receta vigente, una columna por sucursal de `sucursales` (siempre las de `ctx.membresias`). */
export async function compararRendimientosDeSucursales(
  sucursales: readonly { id: string; nombre: string }[],
  filtro: FiltroComparacionRendimiento,
  db: Db = prisma
): Promise<FilaComparacionRendimiento[]> {
  return compararRendimientosPorSucursal(sucursales, filtro, db);
}
