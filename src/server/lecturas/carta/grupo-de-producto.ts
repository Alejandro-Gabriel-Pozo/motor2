import "server-only";
import { preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { precioDeCarta, whereCartaDeSucursal, type GrupoDeProducto } from "@/core/carta/public";
import type { Db } from "@/lib/db-tipos";

/**
 * "¿Este producto está en un ítem agrupado de la carta, y con quiénes?" (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8): la LECTURA. La usan las acciones
 * de Catálogo (`actualizarProducto`) y de Precio Local (`setPrecioLocalProducto`) para OFRECER aplicar el mismo precio a los hermanos del grupo después de guardar.
 * Es el ÚNICO lugar fuera de la carta que lee sus tablas (inventariado por `test/arquitectura/carta-estructura-lectores-inventariados.test.ts`). Solo lectura
 * (lo fija test/arquitectura/carta-solo-lectura.test.ts). Los tipos y `ofrecerSincronizarPrecio` son puros y viven en `core/carta/grupo-de-producto.ts`.
 */
/** `null` si el producto no está en ningún ítem agrupado. */
export async function resolverGrupoDeProducto(productoId: string, sucursalId: string, db: Db): Promise<GrupoDeProducto | null> {
  const opcion = await db.opcionItemAgrupadoCarta.findFirst({
    where: { productoId, ...whereCartaDeSucursal(sucursalId) },
    select: {
      itemAgrupadoCarta: {
        select: {
          id: true,
          nombre: true,
          opciones: {
            where: { productoId: { not: productoId } },
            select: { orden: true, producto: { select: { id: true, nombre: true, precioVenta: true } } },
          },
        },
      },
    },
  });
  if (!opcion) return null;

  const item = opcion.itemAgrupadoCarta;
  const ids = item.opciones.map((o) => o.producto.id);
  const localPorProducto = await preciosLocalesVigentes(sucursalId, db, ids);

  return {
    itemAgrupadoCartaId: item.id,
    nombreItem: item.nombre,
    hermanos: [...item.opciones]
      .sort((a, b) => a.orden - b.orden || a.producto.nombre.localeCompare(b.producto.nombre, "es"))
      .map((o) => {
        const precioVenta = Number(o.producto.precioVenta);
        return { productoId: o.producto.id, nombre: o.producto.nombre, precioVenta, precioActual: precioDeCarta(precioVenta, localPorProducto.get(o.producto.id)) };
      }),
  };
}

/**
 * Fase 4 de la ola «precio y carta» (ADR-035): el nombre de un ítem agrupado de la carta, en ALGUNA de las sucursales dadas, en que está el producto (o `null`). Un producto que se vende por opción no puede
 * estar en ninguno (el renglón agrupado muestra su precio guardado, que no se cobra): lo mira la edición del producto al pasarlo a base, con todas las sucursales de la empresa y la fila del producto tomada.
 */
export async function itemAgrupadoDelProductoEn(productoId: string, sucursalIds: readonly string[], db: Db): Promise<string | null> {
  if (sucursalIds.length === 0) return null;
  const fila = await db.opcionItemAgrupadoCarta.findFirst({
    where: { productoId, OR: sucursalIds.map((sucursalId) => whereCartaDeSucursal(sucursalId)) },
    select: { itemAgrupadoCarta: { select: { nombre: true } } },
  });
  return fila?.itemAgrupadoCarta.nombre ?? null;
}
