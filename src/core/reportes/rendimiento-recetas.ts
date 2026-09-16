import { prisma } from "@/lib/db";
import { redondearCantidad } from "./comun";
import type { Db } from "./comun";

export interface FilaRendimientoSimple {
  productoVentaId: string;
  productoVentaNombre: string;
  recetaIngredienteId: string;
  /** El id de la MP anclada en la receta — para el link "usar este valor" al editor (?editar=). */
  insumoProductoId: string;
  insumoONombre: string;
  unidadRecetaNombre: string;
  cantidadActual: number;
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  totalComprado: number;
  totalVendido: number;
  semanasConDatos: number;
  confianza: "alta" | "media" | "baja" | "sin_datos";
}

function rangoUtc(desdeIn: Date, hastaIn: Date): { desde: Date; hasta: Date } {
  const desde = new Date(desdeIn);
  desde.setUTCHours(0, 0, 0, 0);
  const hasta = new Date(hastaIn);
  hasta.setUTCHours(23, 59, 59, 999);
  return { desde, hasta };
}

const MS_POR_SEMANA = 7 * 24 * 60 * 60 * 1000;

function contarSemanasConDatos(fechas: Date[]): number {
  return new Set(fechas.map((f) => Math.floor(f.getTime() / MS_POR_SEMANA))).size;
}

function calcularConfianza(semanas: number): FilaRendimientoSimple["confianza"] {
  if (semanas === 0) return "sin_datos";
  if (semanas >= 8) return "alta";
  if (semanas >= 4) return "media";
  return "baja";
}

/**
 * Fase 1 del diseño (docs/diseno-rendimiento-recetas-por-sucursal.md §3.3):
 * solo el caso simple, un único PV consume de un Insumo/MP puntual — ahí
 * el "rendimiento real" es una división (compras / ventas), no hace falta
 * regresión. El caso compartido (2+ PVs del mismo pool) queda para la Fase
 * 2, todavía no implementada — se omite acá a propósito, no se estima con
 * un método que no da una respuesta confiable.
 *
 * Corre SIEMPRE para UNA sola sucursal — nunca mezclado entre sucursales
 * (mismo motivo del diseño: mezclar promedia al cocinero que gasta poco
 * con el que gasta mucho y destruye la comparación que se busca).
 */
export async function calcularRendimientoRecetasSimples(
  sucursalId: string,
  desdeIn: Date,
  hastaIn: Date,
  db: Db = prisma
): Promise<FilaRendimientoSimple[]> {
  const { desde, hasta } = rangoUtc(desdeIn, hastaIn);

  const productosConReceta = await db.producto.findMany({
    where: { activo: true, recetaVersiones: { some: {} } },
    include: {
      recetaVersiones: {
        orderBy: { version: "desc" },
        take: 1,
        include: { ingredientes: { include: { insumoProducto: true, unidad: true } } },
      },
    },
  });

  interface UsoDeInsumo {
    pvProductoId: string;
    pvNombre: string;
    recetaIngredienteId: string;
    insumoProductoId: string;
    cantidad: number;
    unidadNombre: string;
  }

  // Agrupa cada línea de receta por "pool" (todos los hermanos activos del
  // mismo Insumo, si el insumo tiene uno asignado — mismo criterio de
  // agrupación que resolverConsumoPorFamilia; o el producto puntual solo,
  // si no tiene Insumo). Fase 1 solo procesa los pools con UN único PV.
  const poolNombrePorClave = new Map<string, string>();
  const productoIdsPorClave = new Map<string, Set<string>>();
  const usosPorClave = new Map<string, UsoDeInsumo[]>();

  for (const pv of productosConReceta) {
    const vigente = pv.recetaVersiones[0];
    if (!vigente) continue;
    for (const ing of vigente.ingredientes) {
      const clave = ing.insumoProducto.insumoId ? `insumo:${ing.insumoProducto.insumoId}` : `producto:${ing.insumoProductoId}`;

      if (!productoIdsPorClave.has(clave)) productoIdsPorClave.set(clave, new Set());
      productoIdsPorClave.get(clave)!.add(ing.insumoProductoId);
      poolNombrePorClave.set(clave, ing.insumoProducto.nombre);

      if (!usosPorClave.has(clave)) usosPorClave.set(clave, []);
      usosPorClave.get(clave)!.push({
        pvProductoId: pv.id,
        pvNombre: pv.nombre,
        recetaIngredienteId: ing.id,
        insumoProductoId: ing.insumoProductoId,
        cantidad: Number(ing.cantidad),
        unidadNombre: ing.unidad.nombre,
      });
    }
  }

  // Si el Insumo agrupa más de una MP, el pool de compras es TODOS los
  // hermanos activos (no solo el que quedó anclado en la receta) — mismo
  // criterio de "familia completa" que usa el consumo real de stock.
  for (const [clave, productoIds] of productoIdsPorClave) {
    if (!clave.startsWith("insumo:")) continue;
    const insumoId = clave.slice("insumo:".length);
    const hermanos = await db.producto.findMany({ where: { insumoId, tipo: "MP", activo: true }, select: { id: true } });
    for (const h of hermanos) productoIds.add(h.id);
  }

  const filas: FilaRendimientoSimple[] = [];

  for (const [clave, usos] of usosPorClave) {
    if (usos.length !== 1) continue; // Fase 2, no implementada — se omite.
    const uso = usos[0];
    const productoIds = Array.from(productoIdsPorClave.get(clave)!);

    const [compras, ventas] = await Promise.all([
      db.movimientoStock.findMany({
        where: { seccion: { sucursalId }, operacion: { fecha: { gte: desde, lte: hasta } }, proceso: "COMPRA", productoId: { in: productoIds } },
        select: { cantidad: true, operacion: { select: { fecha: true } } },
      }),
      db.movimientoStock.findMany({
        where: { seccion: { sucursalId }, operacion: { fecha: { gte: desde, lte: hasta } }, proceso: "VENTA", productoId: uso.pvProductoId },
        select: { cantidad: true, operacion: { select: { fecha: true } } },
      }),
    ]);

    const totalComprado = redondearCantidad(compras.reduce((acc, m) => acc + Number(m.cantidad), 0));
    const totalVendido = redondearCantidad(ventas.reduce((acc, m) => acc + Math.abs(Number(m.cantidad)), 0));
    const semanasConDatos = contarSemanasConDatos([...compras, ...ventas].map((m) => m.operacion.fecha));

    const cantidadEstimada = totalVendido > 0 ? redondearCantidad(totalComprado / totalVendido) : null;
    const desviacionPorcentaje =
      cantidadEstimada !== null && uso.cantidad > 0 ? Math.round(((cantidadEstimada - uso.cantidad) / uso.cantidad) * 1000) / 10 : null;

    filas.push({
      productoVentaId: uso.pvProductoId,
      productoVentaNombre: uso.pvNombre,
      recetaIngredienteId: uso.recetaIngredienteId,
      insumoProductoId: uso.insumoProductoId,
      insumoONombre: poolNombrePorClave.get(clave)!,
      unidadRecetaNombre: uso.unidadNombre,
      cantidadActual: uso.cantidad,
      cantidadEstimada,
      desviacionPorcentaje,
      totalComprado,
      totalVendido,
      semanasConDatos,
      confianza: calcularConfianza(semanasConDatos),
    });
  }

  filas.sort(
    (a, b) => a.productoVentaNombre.localeCompare(b.productoVentaNombre, "es") || a.insumoONombre.localeCompare(b.insumoONombre, "es")
  );
  return filas;
}
