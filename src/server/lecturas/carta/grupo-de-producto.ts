import "server-only";
import { preciosLocalesVigentes } from "@/core/catalogo/public-servidor";
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
