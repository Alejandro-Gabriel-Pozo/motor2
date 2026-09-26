import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { whereDisponibleEn } from "@/core/catalogo/disponibilidad-producto-consulta";
import { precioDeCarta } from "@/core/carta/armar-menu";
import { resolverMenuCarta } from "@/core/carta/menu-consulta";
import { armarSelectorCartaPos, type ProductoPedible, type SelectorCartaPos } from "./selector-carta";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Capa de LECTURA del selector por sección de carta del POS (docs/plan-selector-carta-pos-2026-09-25.md) — separada de
 * `selector-carta.ts` (puro) por el mismo motivo que `menu-consulta.ts`. Solo lee. Vive en `core/pos` y no en `core/carta`: es una
 * necesidad del salón que REUSA la carta sin tocarla (mismo criterio que `grupo-producto-consulta.ts`).
 *
 *  - La estructura: la carta pública de la sucursal, tal cual (`resolverMenuCarta`). Sucursal inactiva → `null` → todo a «Fuera de
 *    carta».
 *  - Los pedibles: los PV disponibles en la sucursal (`whereDisponibleEn`, el mismo filtro que el buscador del POS y que valida
 *    `agregarItems`), con el precio que se congelaría al agregarlos: Precio Local habilitado o, si no, el global (`precioDeCarta`,
 *    paridad con `resolverPrecioVenta`, fijada por test/pos/selector-carta-consulta.test.ts).
 *
 * La pantalla de la mesa la llama DESPUÉS de su guarda de Ver de `pos_mesas` (el mozo no tiene el permiso `carta`): no hace falta
 * ninguna Server Action nueva.
 */
export async function cargarSelectorCartaPos(sucursalId: string, db: Db = prisma): Promise<SelectorCartaPos> {
  const [carta, productos, preciosLocales] = await Promise.all([
    resolverMenuCarta(sucursalId, db),
    db.producto.findMany({ where: { tipo: "PV", ...whereDisponibleEn(sucursalId) }, select: { id: true, codigo: true, nombre: true, precioVenta: true } }),
    db.precioLocalProducto.findMany({ where: { sucursalId, habilitado: true }, select: { productoId: true, precio: true, habilitado: true } }),
  ]);
  const localPorProducto = new Map(preciosLocales.map((pl) => [pl.productoId, { precio: Number(pl.precio), habilitado: pl.habilitado }]));
  const pedibles: ProductoPedible[] = productos.map((p) => ({
    productoId: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    precio: precioDeCarta(Number(p.precioVenta), localPorProducto.get(p.id)),
  }));
  return armarSelectorCartaPos(carta, pedibles);
}
