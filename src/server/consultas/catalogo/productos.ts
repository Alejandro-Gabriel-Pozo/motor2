import "server-only";
import { prisma, type Db } from "@/lib/db";

/**
 * Lecturas de Catálogo › Productos para los Server Components (Task #41, Fase D — piloto de `src/server/consultas/`).
 *
 * Contrato de la capa (vale para todo `server/consultas/<dominio>/<archivo>.ts`):
 *  - `import "server-only"` y SIN `"use server"`: no es un endpoint, no se puede llamar desde el cliente.
 *  - SIN guarda de permiso adentro: la página hace `obtenerContextoUsuario()` + `requierePermisoVer(...)` ANTES de llamar acá.
 *  - Argumentos explícitos; un `sucursalId` sale siempre de `ctx` en el servidor, nunca de algo que mande el cliente.
 *  - Último parámetro `db: Db = prisma` (el singleton o el `tx` de una transacción); nunca abre una conexión propia.
 *  - Devuelve EXACTAMENTE lo que devolvía la consulta Prisma que reemplaza (mismo `where`/`include`/`select`, mismo
 *    `findUnique` vs `findUniqueOrThrow`, mismo tipo inferido): moverla acá no cambia lo que la página serializa al cliente.
 *  - Funciones `async`: devuelven una Promise común (no la PrismaPromise perezosa, que dejaría encadenar la API fluida de Prisma).
 *  - CUÁNDO se llama cada consulta (ternarios, `if`, `Promise.all`) lo decide la página, no este archivo.
 */

/** Ficha de un producto (`/catalogo/productos/[id]`): el producto con categoría, unidades, insumo (con su grupo) y proveedor de consignación. `null` si no existe. */
export async function obtenerFichaProducto(id: string, db: Db = prisma) {
  return db.producto.findUnique({
    where: { id },
    include: { categoria: true, unidadCompra: true, unidadStock: true, insumo: { include: { grupo: true } }, proveedorConsignacion: true },
  });
}

/**
 * Sección habitual del producto en ESTA sucursal, y solo si apunta a una sección activa de acá — la misma regla con la que la usa
 * el cierre de cuenta del salón (docs/plan-seccion-habitual-stock-2026-09-25.md). Devuelve solo `{ seccion: { nombre } }`, o
 * `null` si no tiene (o la que tiene está inactiva o es de otra sucursal).
 */
export async function obtenerSeccionHabitualEnSucursal(sucursalId: string, productoId: string, db: Db = prisma) {
  return db.seccionHabitualProducto.findFirst({
    where: { sucursalId, productoId, seccion: { sucursalId, activa: true } },
    select: { seccion: { select: { nombre: true } } },
  });
}

/** El producto solo, sin relaciones (formulario de edición, `/catalogo/productos/[id]/editar`). `null` si no existe. */
export async function obtenerProductoPorId(id: string, db: Db = prisma) {
  return db.producto.findUnique({ where: { id } });
}
