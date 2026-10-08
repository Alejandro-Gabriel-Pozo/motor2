import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Escrituras de los PRODUCTOS del catálogo (`Producto`, sus presentaciones de compra y su disponibilidad por sucursal; Hito 4 de la pureza, bloque 4.3, pasos
 * H4C-11 a H4C-13 — `docs/plan-hito-4-pureza.md` §3; mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, sin reglas de
 * negocio). Son EXACTAMENTE las escrituras que antes hacían en línea las mutaciones de `src/server/actions/catalogo/productos.ts`; las llaman sus casos de uso.
 *
 * Auditoría (`escrituras-auditadas.test.ts`): el factor de conversión de una presentación (`guardarPresentacion`) y la disponibilidad por sucursal
 * (`fijarDisponibilidadEnSucursal`) los audita el caso de uso que las llama; el factor de la presentación, en la misma transacción.
 */

/**
 * Los campos de un producto nuevo además de su código y su tipo: los que arma `datosParaGuardar` (server/lecturas/catalogo/datos-de-producto.ts) en el alta
 * completa, o solo nombre, unidad de stock y factor en el alta rápida de una MP (los demás quedan en su valor por defecto del esquema). Un campo AUSENTE no se
 * escribe (strictUndefinedChecks no admite `undefined`).
 */
interface CamposDeProductoNuevo {
  nombre: string;
  unidadStockId: string;
  factorConversion: number;
  categoriaId?: string | null;
  unidadCompraId?: string | null;
  insumoId?: string | null;
  precioVenta?: number;
  pasoVenta?: number | null;
  seProduce?: boolean;
  esConsignacion?: boolean;
  proveedorConsignacionId?: string | null;
  precioConsignacion?: number;
  observaciones?: string;
}

/**
 * Crea el producto con ese código y ese tipo (el `intentar` de `crearConCodigoAutogenerado`: un código repetido hace lanzar el P2002 que dispara el reintento).
 * Devuelve el id, el código y el nombre guardados. NO se audita por diseño (excepción `persistencia/catalogo/productos.ts|crearProductoNuevo` de
 * escrituras-auditadas, que antes eran `darDeAltaProducto` y `darDeAltaProductoRapido` de la acción): un alta no tiene valor anterior que se pierda, y se crea SIN
 * transacción a propósito (el reintento del código, ver `dar-de-alta-producto.ts`), así que la auditoría no podría ir atómica con la creación. Cada cambio
 * posterior del precio lo audita la edición.
 */
export async function crearProductoNuevo(
  db: Prisma.TransactionClient,
  args: { codigo: string; tipo: "MP" | "PV"; campos: CamposDeProductoNuevo },
): Promise<{ id: string; codigo: string; nombre: string }> {
  const creado = await db.producto.create({ data: { codigo: args.codigo, tipo: args.tipo, ...args.campos } });
  return { id: creado.id, codigo: creado.codigo, nombre: creado.nombre };
}

/**
 * Siembra la disponibilidad de un producto RECIÉN creado: una fila `disponible: true` por cada sucursal pedida. Va DESPUÉS de crear el producto, fuera de una
 * transacción con él (ver `dar-de-alta-producto.ts`). NO se audita por diseño (excepción `persistencia/catalogo/productos.ts|sembrarDisponibilidadDeProductoNuevo`
 * de escrituras-auditadas): es parte del alta, no hay valor anterior; cada cambio posterior lo audita `actualizarDisponibilidadProducto`.
 */
export async function sembrarDisponibilidadDeProductoNuevo(db: Prisma.TransactionClient, args: { productoId: string; sucursalIds: readonly string[] }): Promise<void> {
  await db.disponibilidadProducto.createMany({
    data: args.sucursalIds.map((sucursalId) => ({ sucursalId, productoId: args.productoId, disponible: true })),
  });
}

/** Pone el insumo de un producto (la mitad retroactiva del asistente de hermanar). */
export async function fijarInsumoDeProducto(db: Prisma.TransactionClient, args: { id: string; insumoId: string }): Promise<void> {
  await db.producto.update({ where: { id: args.id }, data: { insumoId: args.insumoId } });
}

/**
 * Crea la presentación de compra (producto, unidad de compra) con ese factor, o si ya existía le pone el factor nuevo y la reactiva. Devuelve el id de la fila
 * (para la auditoría del factor).
 */
export async function guardarPresentacion(
  db: Prisma.TransactionClient,
  args: { productoId: string; unidadCompraId: string; factorConversion: number },
): Promise<{ id: string }> {
  const fila = await db.presentacion.upsert({
    where: { productoId_unidadCompraId: { productoId: args.productoId, unidadCompraId: args.unidadCompraId } },
    update: { factorConversion: args.factorConversion, activa: true },
    create: { productoId: args.productoId, unidadCompraId: args.unidadCompraId, factorConversion: args.factorConversion },
  });
  return { id: fila.id };
}

/** Activa o desactiva una presentación de compra. NO chequea que exista: un id roto hace lanzar a Prisma (como antes). */
export async function fijarActivaDePresentacion(db: Prisma.TransactionClient, args: { id: string; activa: boolean }): Promise<void> {
  await db.presentacion.update({ where: { id: args.id }, data: { activa: args.activa } });
}

/** Disponibilidad del producto en UNA sucursal (si la sucursal no tenía fila, la crea con ese estado). */
export async function fijarDisponibilidadEnSucursal(db: Prisma.TransactionClient, args: { sucursalId: string; productoId: string; disponible: boolean }): Promise<void> {
  await db.disponibilidadProducto.upsert({
    where: { sucursalId_productoId: { sucursalId: args.sucursalId, productoId: args.productoId } },
    update: { disponible: args.disponible },
    create: { sucursalId: args.sucursalId, productoId: args.productoId, disponible: args.disponible },
  });
}
