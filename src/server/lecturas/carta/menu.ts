import { precioLocalActivoEn, preciosLocalesVigentes } from "@/core/catalogo/public-servidor";
import { whereDisponibleEn } from "@/core/catalogo/public";
import { armarMenuCarta, precioDePromo, seleccionDeSucursalDePromo, whereCartaDeSucursal, wherePromoOfrecidaEn, type CartaV1, type MenuArmado } from "@/core/carta/public";
import { descuentosDeProductoEnSucursal } from "@/server/lecturas/carta/descuentos";
import type { Db } from "@/lib/db-tipos";

/**
 * Capa de LECTURA de la carta pública (docs/plan-carta-catalogo-2026-09-24.md, M3) — separada de `armar-menu.ts` (puro)
 * por el mismo motivo que `disponibilidad-producto-consulta.ts`: nunca mezclar Prisma con funciones puras.
 *
 * NUNCA ESCRIBE (lo fija test/arquitectura/carta-solo-lectura.test.ts): la carta es un espejo de solo lectura del
 * catálogo. Qué entra:
 *  - PV disponibles en la sucursal — con `whereDisponibleEn`, el único lugar que escribe ese filtro ("fila ausente = no
 *    disponible", guardián disponibilidad-en-un-solo-lugar.test.ts);
 *  - y con `ContenidoCartaProducto.visibleEnCarta` en true EN LA CARTA PROPIA DE ESTA SUCURSAL (sin fila de contenido = no se muestra, decisión D3;
 *    una sucursal sin carta propia no muestra nada: ADR-009, C3);
 *  - con el precio local habilitado de la sucursal si lo hay (la regla la aplica `precioDeCarta`);
 *  - ubicados DIRECTO en las secciones de carta ACTIVAS, cada uno por su `seccionCartaId` (docs/plan-carta-seccion-directa-2026-09-25.md;
 *    la Categoría de producto solo viaja como texto informativo);
 *  - más las promos ofrecidas en ESTA sucursal (activas en la empresa y prendidas acá), con su precio local si lo tienen;
 *  - más los ítems AGRUPADOS activos (docs/plan-agrupacion-items-carta-2026-09-24.md, M3), cada uno con sus opciones PV
 *    disponibles acá. Un producto que es opción de un ítem agrupado NO entra como suelto (D3), esté prendido o apagado su
 *    grupo: apagar "Gaseosa 500cc" no hace aparecer tres gaseosas sueltas.
 *
 * Una sucursal inexistente o inactiva da `null` (el endpoint responde 404 igual en los dos casos, para no revelar cuál).
 */
export async function resolverMenuCartaConDiagnostico(sucursalId: string, db: Db, ahora: Date = new Date()): Promise<MenuArmado | null> {
  const sucursal = await db.sucursal.findUnique({ where: { id: sucursalId }, select: { id: true, nombre: true, activo: true, empresaId: true } });
  if (!sucursal || !sucursal.activo) return null;
  // Filtro explícito por la empresa de la sucursal, además del RLS: con un rol que lo salta, secciones/promos/agrupados no se mezclan entre empresas.
  const { empresaId } = sucursal;

  const [productos, secciones, promos, agrupados] = await Promise.all([
    db.producto.findMany({
      where: { empresaId, tipo: "PV", ...whereDisponibleEn(sucursalId), contenidosCarta: { some: { ...whereCartaDeSucursal(sucursalId), visibleEnCarta: true } }, opcionesItemAgrupadoCarta: { none: whereCartaDeSucursal(sucursalId) } },
      select: {
        id: true,
        nombre: true,
        precioVenta: true,
        categoria: { select: { nombre: true } },
        contenidosCarta: { where: whereCartaDeSucursal(sucursalId), select: { seccionCartaId: true, descripcion: true, tags: true, especial: true, orden: true }, take: 1 },
      },
    }),
    db.seccionCarta.findMany({
      where: { empresaId, activa: true },
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
      where: { empresaId, ...wherePromoOfrecidaEn(sucursalId) },
      select: { id: true, seccionCartaId: true, titulo: true, descripcion: true, precio: true, orden: true, sucursales: seleccionDeSucursalDePromo(sucursalId) },
    }),
    db.itemAgrupadoCarta.findMany({
      where: { empresaId, activo: true, ...whereCartaDeSucursal(sucursalId) },
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
  const [preciosLocales, descuentos, precioLocalActivo] = await Promise.all([
    preciosLocalesVigentes(sucursalId, db, idsConPrecio),
    descuentosDeProductoEnSucursal(sucursalId, db, productos.map((p) => p.id)),
    precioLocalActivoEn(sucursalId, db),
  ]);

  return armarMenuCarta({
    sucursal: { id: sucursal.id, nombre: sucursal.nombre },
    generadoEn: ahora,
    secciones,
    productos: productos.flatMap((p) =>
      // El `where` ya exige la fila de contenido de ESTA sucursal; el guard es solo para el tipo.
      p.contenidosCarta[0]
        ? [
            {
              id: p.id,
              nombre: p.nombre,
              precioVenta: Number(p.precioVenta),
              categoriaNombre: p.categoria?.nombre ?? null,
              seccionCartaId: p.contenidosCarta[0].seccionCartaId,
              contenido: p.contenidosCarta[0],
            },
          ]
        : []
    ),
    preciosLocales: [...preciosLocales].map(([productoId, pl]) => ({ productoId, precio: pl.precio, habilitado: pl.habilitado })),
    descuentos: [...descuentos].map(([productoId, porcentaje]) => ({ productoId, porcentaje })),
    promos: promos.map(({ sucursales, ...pr }) => ({ ...pr, precio: precioDePromo(pr.precio, sucursales[0], precioLocalActivo) })),
    agrupados: agrupados.map((ag) => ({
      id: ag.id,
      nombre: ag.nombre,
      seccionCartaId: ag.seccionCartaId,
      contenido: { descripcion: ag.descripcion, tags: ag.tags, especial: ag.especial, orden: ag.orden },
      opciones: ag.opciones.map((o) => ({ productoId: o.producto.id, nombre: o.producto.nombre, precioVenta: Number(o.producto.precioVenta), orden: o.orden })),
    })),
  });
}

/** La carta pública de una sucursal, tal como la consume la página pública (sin el diagnóstico interno). */
export async function resolverMenuCarta(sucursalId: string, db: Db, ahora: Date = new Date()): Promise<CartaV1 | null> {
  const armado = await resolverMenuCartaConDiagnostico(sucursalId, db, ahora);
  return armado ? armado.carta : null;
}
