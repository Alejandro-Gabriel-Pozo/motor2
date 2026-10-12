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
  return leerDisponibilidad(productoId, null, db);
}

/**
 * Para el editor de recetas (M.3): el estado SOLO en las sucursales activas de `sucursalIds`, las que la pantalla ya calculó como visibles para el usuario (`lecturaEnSucursalesVisibles`); su `db`
 * es el de ese contexto ampliado. Como segunda llave, solo cuentan las sucursales donde `usuarioId` tiene membresía vigente: un id que se le cuele (de otra sucursal, de otra empresa o inexistente) no suma
 * nada. Las demás sucursales no salen aunque tengan fila y una lista vacía devuelve `[]` (nunca «todas»).
 */
export async function disponibilidadDeProductoEnSucursales(productoId: string, usuarioId: string, sucursalIds: readonly string[], db: Db): Promise<DisponibilidadEnSucursal[]> {
  return leerDisponibilidad(productoId, { usuarioId, sucursalIds }, db);
}

/** `acotada` = `null`: todas las sucursales activas; con ella: solo las activas de esa lista donde el usuario tiene membresía vigente. */
async function leerDisponibilidad(productoId: string, acotada: { usuarioId: string; sucursalIds: readonly string[] } | null, db: Db): Promise<DisponibilidadEnSucursal[]> {
  const [sucursales, filas] = await Promise.all([
    db.sucursal.findMany({
      where: { activo: true, ...(acotada && { id: { in: [...acotada.sucursalIds] }, usuarios: { some: { usuarioId: acotada.usuarioId, activo: true } } }) },
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" },
    }),
    db.disponibilidadProducto.findMany({ where: { productoId, ...(acotada && { sucursalId: { in: [...acotada.sucursalIds] } }) } }),
  ]);
  const porSucursal = resolverDisponibilidadPorSucursal(filas, sucursales.map((s) => s.id));
  return sucursales.map((s) => ({ sucursalId: s.id, sucursalNombre: s.nombre, disponible: porSucursal.get(s.id) === true }));
}
