import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { whereDisponibleEn } from "@/core/catalogo/disponibilidad-producto-consulta";
import { armarMenuCarta, type CartaV1, type MenuArmado } from "./armar-menu";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Capa de LECTURA de la carta pública (docs/plan-carta-catalogo-2026-09-24.md, M3) — separada de `armar-menu.ts` (puro)
 * por el mismo motivo que `disponibilidad-producto-consulta.ts`: nunca mezclar Prisma con funciones puras.
 *
 * NUNCA ESCRIBE (lo fija test/arquitectura/carta-solo-lectura.test.ts): la carta es un espejo de solo lectura del
 * catálogo. Qué entra:
 *  - PV disponibles en la sucursal — con `whereDisponibleEn`, el único lugar que escribe ese filtro ("fila ausente = no
 *    disponible", guardián disponibilidad-en-un-solo-lugar.test.ts);
 *  - y con `ContenidoCartaProducto.visibleEnCarta` en true (sin fila de contenido = no se muestra, decisión D3);
 *  - con el precio local habilitado de la sucursal si lo hay (la regla la aplica `precioDeCarta`);
 *  - agrupados por las secciones de carta ACTIVAS;
 *  - más las promos activas de ESTA sucursal.
 *
 * Una sucursal inexistente o inactiva da `null` (el endpoint responde 404 igual en los dos casos, para no revelar cuál).
 */
export async function resolverMenuCartaConDiagnostico(sucursalId: string, db: Db = prisma, ahora: Date = new Date()): Promise<MenuArmado | null> {
  const sucursal = await db.sucursal.findUnique({ where: { id: sucursalId }, select: { id: true, nombre: true, activo: true } });
  if (!sucursal || !sucursal.activo) return null;

  const [productos, secciones, promos] = await Promise.all([
    db.producto.findMany({
      where: { tipo: "PV", ...whereDisponibleEn(sucursalId), contenidoCarta: { is: { visibleEnCarta: true } } },
      select: {
        id: true,
        nombre: true,
        precioVenta: true,
        categoriaId: true,
        categoria: { select: { nombre: true } },
        contenidoCarta: { select: { descripcion: true, imagenUrl: true, tags: true, especial: true, orden: true } },
      },
    }),
    db.seccionCarta.findMany({
      where: { activa: true },
      select: {
        id: true,
        nombre: true,
        titulo: true,
        descripcion: true,
        imagenUrl: true,
        orden: true,
        categorias: { select: { categoriaId: true, orden: true } },
      },
    }),
    db.promoCarta.findMany({
      where: { sucursalId, activa: true },
      select: { id: true, seccionCartaId: true, titulo: true, descripcion: true, precio: true, orden: true },
    }),
  ]);

  const preciosLocales =
    productos.length === 0
      ? []
      : await db.precioLocalProducto.findMany({
          where: { sucursalId, habilitado: true, productoId: { in: productos.map((p) => p.id) } },
          select: { productoId: true, precio: true, habilitado: true },
        });

  return armarMenuCarta({
    sucursal: { id: sucursal.id, nombre: sucursal.nombre },
    generadoEn: ahora,
    secciones,
    productos: productos.flatMap((p) =>
      // El `where` ya exige la fila de contenido; el guard es solo para el tipo (la relación es opcional).
      p.contenidoCarta
        ? [
            {
              id: p.id,
              nombre: p.nombre,
              precioVenta: Number(p.precioVenta),
              categoriaId: p.categoriaId,
              categoriaNombre: p.categoria?.nombre ?? null,
              contenido: p.contenidoCarta,
            },
          ]
        : []
    ),
    preciosLocales: preciosLocales.map((pl) => ({ productoId: pl.productoId, precio: Number(pl.precio), habilitado: pl.habilitado })),
    promos: promos.map((pr) => ({ ...pr, precio: Number(pr.precio) })),
  });
}

/** La carta pública de una sucursal, tal como la sirve `GET /api/carta/[sucursal]` (sin el diagnóstico interno). */
export async function resolverMenuCarta(sucursalId: string, db: Db = prisma, ahora: Date = new Date()): Promise<CartaV1 | null> {
  const armado = await resolverMenuCartaConDiagnostico(sucursalId, db, ahora);
  return armado ? armado.carta : null;
}
