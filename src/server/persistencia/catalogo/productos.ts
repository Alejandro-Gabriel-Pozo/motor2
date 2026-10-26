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
 * Los campos de un producto además de su código y su tipo: los que arma `datosParaGuardar` (server/lecturas/catalogo/datos-de-producto.ts) en el alta completa y
 * en la edición, o solo nombre, unidad de stock y factor en el alta rápida de una MP (los demás quedan en su valor por defecto del esquema). Un campo AUSENTE no
 * se escribe (strictUndefinedChecks no admite `undefined`).
 */
interface CamposDeProducto {
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
  /** Fase 4 (ADR-035): «¿Cómo se vende?» (`DIRECTO` / `BASE_CONFIGURABLE`, CHECK de la base). Solo la escribe la edición, con la clave fina; el alta nace DIRECTO (el default). */
  modoDeVenta?: string;
}

/**
 * Lo que escribe la EDICIÓN: lo mismo que el alta, pero sin la unidad de stock y el factor obligatorios. M.2: quien no tiene `producto_campos_sensibles` NO escribe el precio de venta, el factor ni las unidades (el caso de uso
 * los saca del `update`): lo que otra persona haya cambiado entre la lectura del producto y esta escritura no se pisa con el valor viejo de un formulario.
 */
type CamposDeEdicionDeProducto = Omit<CamposDeProducto, "unidadStockId" | "factorConversion"> & Partial<Pick<CamposDeProducto, "unidadStockId" | "factorConversion">>;

/**
 * Crea el producto con ese código y ese tipo (el `intentar` de `crearConCodigoAutogenerado`: un código repetido hace lanzar el P2002 que dispara el reintento).
 * Devuelve el id, el código y el nombre guardados. NO se audita por diseño (excepción `persistencia/catalogo/productos.ts|crearProductoNuevo` de
 * escrituras-auditadas, que antes eran `darDeAltaProducto` y `darDeAltaProductoRapido` de la acción): un alta no tiene valor anterior que se pierda, y se crea SIN
 * transacción a propósito (el reintento del código, ver `dar-de-alta-producto.ts`), así que la auditoría no podría ir atómica con la creación. Cada cambio
 * posterior del precio lo audita la edición.
 */
export async function crearProductoNuevo(
  db: Prisma.TransactionClient,
  args: { codigo: string; tipo: "MP" | "PV"; campos: CamposDeProducto },
): Promise<{ id: string; codigo: string; nombre: string }> {
  const creado = await db.producto.create({ data: { codigo: args.codigo, tipo: args.tipo, ...args.campos } });
  return { id: creado.id, codigo: creado.codigo, nombre: creado.nombre };
}

/**
 * La edición de un producto: le escribe los campos dados (sin `tipo` ni código: no se cambian). La llama `actualizar-producto.ts` dentro de su transacción, junto
 * con las filas de auditoría de los precios y el paso de venta (escrituras-auditadas: la cadena exige que su llamador audite).
 */
export async function actualizarCamposDeProducto(db: Prisma.TransactionClient, args: { id: string; campos: CamposDeEdicionDeProducto }): Promise<void> {
  await db.producto.update({ where: { id: args.id }, data: args.campos });
}

/**
 * El precio de venta GLOBAL de un producto (la sincronización de un ítem agrupado de la carta). La llama `sincronizar-precio-grupo-carta.ts` dentro de su
 * transacción, junto con la fila de auditoría de cada producto.
 */
export async function fijarPrecioVentaDeProducto(db: Prisma.TransactionClient, args: { id: string; precioVenta: number }): Promise<void> {
  await db.producto.update({ where: { id: args.id }, data: { precioVenta: args.precioVenta } });
}

/**
 * Siembra la disponibilidad de un producto RECIÉN creado: una fila por cada sucursal pedida, con `disponible` (M.2-A4: `false` para un producto de venta dado de alta sin
 * `producto_campos_sensibles`, que nace sin precio y no se puede vender hasta que alguien lo active; la fila existe igual, así la ficha y el catálogo muestran «0 de N»). Va DESPUÉS
 * de crear el producto, fuera de una transacción con él (ver `dar-de-alta-producto.ts`). NO se audita por diseño (excepción `persistencia/catalogo/productos.ts|sembrarDisponibilidadDeProductoNuevo`
 * de escrituras-auditadas): es parte del alta, no hay valor anterior; cada cambio posterior lo audita `actualizarDisponibilidadProducto`.
 */
export async function sembrarDisponibilidadDeProductoNuevo(
  db: Prisma.TransactionClient,
  args: { productoId: string; sucursalIds: readonly string[]; disponible: boolean },
): Promise<void> {
  await db.disponibilidadProducto.createMany({
    data: args.sucursalIds.map((sucursalId) => ({ sucursalId, productoId: args.productoId, disponible: args.disponible })),
  });
}

/** Pone el insumo de un producto (la mitad retroactiva del asistente de hermanar). */
export async function fijarInsumoDeProducto(db: Prisma.TransactionClient, args: { id: string; insumoId: string }): Promise<void> {
  await db.producto.update({ where: { id: args.id }, data: { insumoId: args.insumoId } });
}

/**
 * Crea la presentación de compra (producto, unidad de compra) con ese factor, o si ya existía le pone el factor nuevo y la reactiva. Devuelve el id de la fila
 * (para la auditoría del factor). M.2: con `reescribirElFactor: false` (quien no tiene `producto_campos_sensibles`: solo puede reactivar con el MISMO factor) una presentación que ya existía solo se reactiva, sin
 * volver a escribir el factor: lo que otra persona haya cambiado entre la lectura y esta escritura no se pisa.
 */
export async function guardarPresentacion(
  db: Prisma.TransactionClient,
  args: { productoId: string; unidadCompraId: string; factorConversion: number; reescribirElFactor: boolean },
): Promise<{ id: string }> {
  const fila = await db.presentacion.upsert({
    where: { productoId_unidadCompraId: { productoId: args.productoId, unidadCompraId: args.unidadCompraId } },
    update: args.reescribirElFactor ? { factorConversion: args.factorConversion, activa: true } : { activa: true },
    create: { productoId: args.productoId, unidadCompraId: args.unidadCompraId, factorConversion: args.factorConversion },
  });
  return { id: fila.id };
}

/**
 * Activa o desactiva una presentación de compra. Devuelve si había una con ese id (O.44: `updateMany` + `count` en vez del `update` que hacía lanzar a Prisma con
 * un id roto, y S-07: lo que no es texto no escribe; ver `fijarActivaDeCategoria` en `categorias-producto.ts`).
 */
export async function fijarActivaDePresentacion(db: Prisma.TransactionClient, args: { id: string; activa: boolean }): Promise<boolean> {
  if (typeof args.id !== "string") return false;
  const { count } = await db.presentacion.updateMany({ where: { id: args.id }, data: { activa: args.activa } });
  return count > 0;
}

/**
 * Toma la fila del producto (`FOR UPDATE`) hasta el final de la transacción: quien la lee después ve el último estado confirmado y nadie puede cambiarle el precio entre su lectura y su escritura (D4:
 * poner a la venta un producto decide con el precio, y un cambio de precio concurrente espera a que termine). No lee ni escribe datos.
 */
export async function tomarFilaDeProducto(db: Prisma.TransactionClient, productoId: string): Promise<void> {
  await db.$queryRaw`SELECT id FROM "Producto" WHERE id = ${productoId} FOR UPDATE`;
}

/** Disponibilidad del producto en UNA sucursal (si la sucursal no tenía fila, la crea con ese estado). */
export async function fijarDisponibilidadEnSucursal(db: Prisma.TransactionClient, args: { sucursalId: string; productoId: string; disponible: boolean }): Promise<void> {
  await db.disponibilidadProducto.upsert({
    where: { sucursalId_productoId: { sucursalId: args.sucursalId, productoId: args.productoId } },
    update: { disponible: args.disponible },
    create: { sucursalId: args.sucursalId, productoId: args.productoId, disponible: args.disponible },
  });
}

/**
 * GO-2a (D-1, variante A′; ADR-030 §7): el PRODUCTO ANCLA de una opción ADICIONAL, creado DENTRO de la transacción que da de alta la opción (todo o nada). Un PV sin receta, sin
 * categoría, con factor 1 y SIN FILAS DE DISPONIBILIDAD a propósito (NO se llama a `sembrarDisponibilidadDeProductoNuevo`): queda oculto por la semántica «sin fila = no disponible»
 * (ADR-009, familia `optin`) y solo se vende como la línea del adicional. El código lo arma el caso de uso (`PV_<6 del azar>`, como `crearConCodigoAutogenerado`); dentro de una
 * transacción un choque del único no se puede reintentar acá (la transacción quedó abortada): lo reintenta entera `conTransaccionSerializable` con `tambienChoqueDeUnico`, con otro código.
 * El alta se audita en el caso de uso, con el mismo `tx` (escrituras-auditadas: `unidadStockId` y `factorConversion` son columnas de significado).
 */
export async function crearProductoAnclaDeAdicional(
  tx: Prisma.TransactionClient,
  args: { codigo: string; nombre: string; unidadStockId: string; ahora: Date }
): Promise<{ id: string; codigo: string; nombre: string }> {
  return tx.producto.create({
    data: { codigo: args.codigo, nombre: args.nombre, tipo: "PV", unidadStockId: args.unidadStockId, factorConversion: 1, creadoEn: args.ahora },
    select: { id: true, codigo: true, nombre: true },
  });
}
