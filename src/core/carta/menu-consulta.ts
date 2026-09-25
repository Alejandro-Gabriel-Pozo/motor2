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
 *  - ubicados DIRECTO en las secciones de carta ACTIVAS, cada uno por su `seccionCartaId` (docs/plan-carta-seccion-directa-2026-09-25.md;
 *    la Categoría de producto solo viaja como texto informativo);
 *  - más las promos activas de ESTA sucursal;
 *  - más los ítems AGRUPADOS activos (docs/plan-agrupacion-items-carta-2026-09-24.md, M3), cada uno con sus opciones PV
 *    disponibles acá. Un producto que es opción de un ítem agrupado NO entra como suelto (D3), esté prendido o apagado su
 *    grupo: apagar "Gaseosa 500cc" no hace aparecer tres gaseosas sueltas.
 *
 * Una sucursal inexistente o inactiva da `null` (el endpoint responde 404 igual en los dos casos, para no revelar cuál).
 */
export async function resolverMenuCartaConDiagnostico(sucursalId: string, db: Db = prisma, ahora: Date = new Date()): Promise<MenuArmado | null> {
  const sucursal = await db.sucursal.findUnique({ where: { id: sucursalId }, select: { id: true, nombre: true, activo: true } });
  if (!sucursal || !sucursal.activo) return null;

  const [productos, secciones, promos, agrupados] = await Promise.all([
    db.producto.findMany({
      where: { tipo: "PV", ...whereDisponibleEn(sucursalId), contenidoCarta: { is: { visibleEnCarta: true } }, opcionItemAgrupadoCarta: { is: null } },
      select: {
        id: true,
        nombre: true,
        precioVenta: true,
        categoria: { select: { nombre: true } },
        contenidoCarta: { select: { seccionCartaId: true, descripcion: true, tags: true, especial: true, orden: true } },
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
      },
    }),
    db.promoCarta.findMany({
      where: { sucursalId, activa: true },
      select: { id: true, seccionCartaId: true, titulo: true, descripcion: true, precio: true, orden: true },
    }),
    db.itemAgrupadoCarta.findMany({
      where: { activo: true },
      select: {
        id: true,
        nombre: true,
        seccionCartaId: true,
        descripcion: true,
        tags: true,
        especial: true,
        orden: true,
        opciones: {
          where: { producto: { tipo: "PV", ...whereDisponibleEn(sucursalId) } },
          select: { orden: true, producto: { select: { id: true, nombre: true, precioVenta: true } } },
        },
      },
    }),
  ]);

  const idsConPrecio = [...new Set([...productos.map((p) => p.id), ...agrupados.flatMap((ag) => ag.opciones.map((o) => o.producto.id))])];
  const preciosLocales =
    idsConPrecio.length === 0
      ? []
      : await db.precioLocalProducto.findMany({
          where: { sucursalId, habilitado: true, productoId: { in: idsConPrecio } },
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
              categoriaNombre: p.categoria?.nombre ?? null,
              seccionCartaId: p.contenidoCarta.seccionCartaId,
              contenido: p.contenidoCarta,
            },
          ]
        : []
    ),
    preciosLocales: preciosLocales.map((pl) => ({ productoId: pl.productoId, precio: Number(pl.precio), habilitado: pl.habilitado })),
    promos: promos.map((pr) => ({ ...pr, precio: Number(pr.precio) })),
    agrupados: agrupados.map((ag) => ({
      id: ag.id,
      nombre: ag.nombre,
      seccionCartaId: ag.seccionCartaId,
      contenido: { descripcion: ag.descripcion, tags: ag.tags, especial: ag.especial, orden: ag.orden },
      opciones: ag.opciones.map((o) => ({ productoId: o.producto.id, nombre: o.producto.nombre, precioVenta: Number(o.producto.precioVenta), orden: o.orden })),
    })),
  });
}

/** La carta pública de una sucursal, tal como la sirve `GET /api/carta/[sucursal]` (sin el diagnóstico interno). */
export async function resolverMenuCarta(sucursalId: string, db: Db = prisma, ahora: Date = new Date()): Promise<CartaV1 | null> {
  const armado = await resolverMenuCartaConDiagnostico(sucursalId, db, ahora);
  return armado ? armado.carta : null;
}
