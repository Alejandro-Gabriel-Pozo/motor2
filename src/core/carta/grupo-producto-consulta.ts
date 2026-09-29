import type { Prisma, PrismaClient } from "@prisma/client";
import { precioDeCarta } from "./armar-menu";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * "¿Este producto está en un ítem agrupado de la carta, y con quiénes?" (docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8).
 * La usan las acciones de Catálogo (`actualizarProducto`) y de Precio Local (`setPrecioLocalProducto`) para OFRECER aplicar el mismo
 * precio a los hermanos del grupo después de guardar. Es el ÚNICO lugar fuera de la carta que lee sus tablas: así Catálogo no
 * reparte consultas a `opcionItemAgrupadoCarta` por varios archivos.
 *
 * Solo lectura (lo fija test/arquitectura/carta-solo-lectura.test.ts). No cambia quién escribe qué: el precio lo sigue escribiendo
 * la acción de Catálogo/Precio Local, con su propio permiso.
 */

export interface HermanoDeGrupo {
  productoId: string;
  nombre: string;
  /** Precio de venta GLOBAL (`Producto.precioVenta`). */
  precioVenta: number;
  /** Precio que muestra la carta EN LA SUCURSAL pedida (`precioDeCarta`: el local habilitado, si no el global). */
  precioActual: number;
}

export interface GrupoDeProducto {
  itemAgrupadoCartaId: string;
  nombreItem: string;
  /** Las demás opciones del mismo ítem agrupado (sin el producto pedido), por orden y nombre. Vacío si está solo en su grupo. */
  hermanos: HermanoDeGrupo[];
}

/** `null` si el producto no está en ningún ítem agrupado. */
export async function resolverGrupoDeProducto(productoId: string, sucursalId: string, db: Db): Promise<GrupoDeProducto | null> {
  const opcion = await db.opcionItemAgrupadoCarta.findFirst({
    where: { productoId },
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
  const locales =
    ids.length === 0
      ? []
      : await db.precioLocalProducto.findMany({ where: { sucursalId, productoId: { in: ids } }, select: { productoId: true, precio: true, habilitado: true } });
  const localPorProducto = new Map(locales.map((l) => [l.productoId, { precio: Number(l.precio), habilitado: l.habilitado }]));

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
 * Lo que la pantalla ofrece después de cambiar un precio (D11): los hermanos del grupo que quedaron a OTRO precio, para aplicarles
 * el nuevo con un botón aparte (nunca automático).
 */
export interface SincronizablePrecioGrupo {
  itemAgrupadoCartaId: string;
  nombreItem: string;
  precioNuevo: number;
  /** `precioActual`: el precio del hermano que se comparó (el global en Catálogo, el de la carta en la sucursal en Precio Local). */
  hermanos: { productoId: string; nombre: string; precioActual: number }[];
}

/**
 * Pura. `null` si el producto no está agrupado o si todos sus hermanos ya están a `precioNuevo`. `comparar`:
 *  - "global": contra el precio de venta global de cada hermano (Catálogo edita `Producto.precioVenta`);
 *  - "enSucursal": contra el precio que la carta muestra de cada hermano en la sucursal (Precio Local).
 */
export function ofrecerSincronizarPrecio(grupo: GrupoDeProducto | null, precioNuevo: number, comparar: "global" | "enSucursal"): SincronizablePrecioGrupo | null {
  if (!grupo) return null;
  const hermanos = grupo.hermanos
    .map((h) => ({ productoId: h.productoId, nombre: h.nombre, precioActual: comparar === "global" ? h.precioVenta : h.precioActual }))
    .filter((h) => h.precioActual !== precioNuevo);
  if (!hermanos.length) return null;
  return { itemAgrupadoCartaId: grupo.itemAgrupadoCartaId, nombreItem: grupo.nombreItem, precioNuevo, hermanos };
}
