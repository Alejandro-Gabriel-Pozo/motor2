import "server-only";
import type { Db } from "@/lib/db-tipos";
import { whereSeccionHabitualVigente } from "@/core/stock/public";

/**
 * Lecturas de Catálogo › Productos para los Server Components (Task #41, Fase D — piloto de `src/server/consultas/`).
 *
 * Contrato de la capa (vale para todo `server/consultas/<dominio>/<archivo>.ts`):
 *  - `import "server-only"` y SIN `"use server"`: no es un endpoint, no se puede llamar desde el cliente.
 *  - SIN guarda de permiso adentro: la página hace `obtenerContextoUsuario()` + `requierePermisoVer(...)` ANTES de llamar acá.
 *  - Argumentos explícitos; un `sucursalId` sale siempre de `ctx` en el servidor, nunca de algo que mande el cliente.
 *  - Último parámetro `db: Db` (el singleton o el `tx` de una transacción); nunca abre una conexión propia.
 *  - Devuelve EXACTAMENTE lo que devolvía la consulta Prisma que reemplaza (mismo `where`/`include`/`select`, mismo
 *    `findUnique` vs `findUniqueOrThrow`, mismo tipo inferido): moverla acá no cambia lo que la página serializa al cliente.
 *  - Funciones `async`: devuelven una Promise común (no la PrismaPromise perezosa, que dejaría encadenar la API fluida de Prisma).
 *  - CUÁNDO se llama cada consulta (ternarios, `if`, `Promise.all`) lo decide la página, no este archivo.
 */

/**
 * S-12 (plan de endurecimiento de seguridad, T2; D8 del dueño): el COSTO DE CONSIGNACIÓN de un producto —`precioConsignacion`, `proveedorConsignacionId` y el proveedor
 * mismo— es de quien tiene `pagar_consignante` en la sucursal activa. La consulta es el último punto antes de la página: DENIEGA POR DEFECTO. Sin
 * `conCostoDeConsignacion: true` los tres vuelven en `null` (el «es consignación» sí queda: no es el costo); la página lo pasa en `true` solo cuando el gate de su
 * usuario lo dice. `esConsignacion` no se toca.
 */
interface OpcionesDeCostoDeConsignacion {
  conCostoDeConsignacion?: boolean;
}

/**
 * Ficha de un producto (`/catalogo/productos/[id]`): el producto con categoría, unidades, insumo (con su grupo) y proveedor de consignación (SOLO `id` y `nombre`: la ficha
 * no necesita el CUIT, el correo ni las condiciones de pago del proveedor). `null` si no existe. El costo de consignación solo con `conCostoDeConsignacion`.
 */
export async function obtenerFichaProducto(id: string, db: Db, opciones: OpcionesDeCostoDeConsignacion = {}) {
  const p = await db.producto.findUnique({
    where: { id },
    include: { categoria: true, unidadCompra: true, unidadStock: true, insumo: { include: { grupo: true } }, proveedorConsignacion: { select: { id: true, nombre: true } } },
  });
  if (p === null || opciones.conCostoDeConsignacion === true) return p;
  return { ...p, precioConsignacion: null, proveedorConsignacionId: null, proveedorConsignacion: null };
}

/**
 * Sección habitual del producto en ESTA sucursal, y solo si apunta a una sección activa de acá — la misma regla con la que la usa
 * el cierre de cuenta del salón (docs/plan-seccion-habitual-stock-2026-09-25.md). Devuelve solo `{ seccion: { nombre } }`, o
 * `null` si no tiene (o la que tiene está inactiva o es de otra sucursal).
 */
export async function obtenerSeccionHabitualEnSucursal(sucursalId: string, productoId: string, db: Db) {
  return db.seccionHabitualProducto.findFirst({
    where: { ...whereSeccionHabitualVigente(sucursalId), productoId },
    select: { seccion: { select: { nombre: true } } },
  });
}

/**
 * El producto solo, sin relaciones (formulario de edición, `/catalogo/productos/[id]/editar`, y las cabeceras de receta). `null` si no existe. El costo de consignación
 * solo con `conCostoDeConsignacion` (ver `OpcionesDeCostoDeConsignacion`): el formulario de edición lo manda como prop a un componente de cliente, y los props viajan al navegador.
 */
export async function obtenerProductoPorId(id: string, db: Db, opciones: OpcionesDeCostoDeConsignacion = {}) {
  const p = await db.producto.findUnique({ where: { id } });
  if (p === null || opciones.conCostoDeConsignacion === true) return p;
  return { ...p, precioConsignacion: null, proveedorConsignacionId: null };
}

/**
 * El producto como opción de un selector: SOLO `{ id, codigo, nombre }` (deep-link `/movimientos/[proceso]?productoId=` desde
 * un reporte, que llega con el producto ya cargado en la primera fila). `null` si no existe.
 */
export async function obtenerProductoOpcion(id: string, db: Db) {
  return db.producto.findUnique({ where: { id }, select: { id: true, codigo: true, nombre: true } });
}

/**
 * Cuántas sucursales tiene la empresa, activas o no (SIN filtro: el mismo número que daba `listarSucursales().length`), para el texto del alta de producto
 * (`/catalogo/productos/nuevo`: «disponible en las N sucursales que existen hoy»). H8 (decisión D-3 del dueño): la página dejó de llamar a
 * `listarSucursales`, que desde entonces exige `gestion_usuarios` o `alta_sucursal`; quien da de alta un producto solo necesita la cuenta.
 */
export async function contarSucursales(db: Db): Promise<number> {
  return db.sucursal.count();
}
