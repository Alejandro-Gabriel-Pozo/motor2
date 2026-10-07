import "server-only";
import { resolverDisponibilidadPorSucursal } from "@/core/catalogo/public";
import type { Db } from "@/lib/db-tipos";

/**
 * La disponibilidad de UN producto en cada sucursal activa, para las fichas de producto y de receta. Solo la piden las pantallas, así que es una consulta (`server/consultas`) y no una
 * lectura compartida (`server/lecturas/catalogo/disponibilidad.ts` queda con los lectores que usan la venta y los reportes); mudada TAL CUAL, mismo nombre y firma. Sin guarda de permiso
 * adentro: la página la pone antes.
 */
export interface DisponibilidadEnSucursal {
  sucursalId: string;
  sucursalNombre: string;
  disponible: boolean;
}

/** Para la ficha de producto: el estado en TODAS las sucursales activas, incluidas las que no tienen fila propia (quedan en `false`). */
export async function disponibilidadPorSucursalDeProducto(productoId: string, db: Db): Promise<DisponibilidadEnSucursal[]> {
  const [sucursales, filas] = await Promise.all([
    db.sucursal.findMany({ where: { activo: true }, select: { id: true, nombre: true }, orderBy: { nombre: "asc" } }),
    db.disponibilidadProducto.findMany({ where: { productoId } }),
  ]);
  const porSucursal = resolverDisponibilidadPorSucursal(filas, sucursales.map((s) => s.id));
  return sucursales.map((s) => ({ sucursalId: s.id, sucursalNombre: s.nombre, disponible: porSucursal.get(s.id) === true }));
}
