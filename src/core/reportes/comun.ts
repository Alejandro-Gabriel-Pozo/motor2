import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { clasificarGruposNoComestibles, type ClasificacionNoComestibles } from "@/core/catalogo/no-comestibles";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface InfoProductoReporte {
  id: string;
  codigo: string;
  nombre: string;
  tipo: "MP" | "PV";
  activo: boolean;
  seProduce: boolean;
  precioVenta: number;
  categoriaNombre: string | null;
  /// Nombre interno histórico "Familia" en Apps Script (Catalogo.js:180-197)
  /// — es el Insumo, no el árbol de Grupo (ver docstring del modelo Insumo).
  insumoNombre: string | null;
  /// Grupo (familia) del Insumo — sí es el árbol de Grupo, un nivel más
  /// arriba que insumoNombre. Null si el producto no tiene Insumo o el
  /// Insumo no está agrupado. Agregado para reportes de gasto por
  /// categoría (docs/grounding-reportes-compras-2026-09-18.md).
  grupoNombre: string | null;
  /** El Insumo del producto está en el grupo «No comestibles» (o en un hijo): packaging, limpieza… Ver core/catalogo/no-comestibles.ts. */
  esNoComestible: boolean;
  unidadStockNombre: string;
  esConsignacion: boolean;
  proveedorConsignacionNombre: string | null;
}

/** Qué grupos del árbol cuentan como «No comestibles» (una consulta chica: la tabla de Grupos es corta). */
export async function cargarClasificacionNoComestibles(db: Db = prisma): Promise<ClasificacionNoComestibles> {
  const grupos = await db.grupo.findMany({ select: { id: true, nombre: true, grupoPadreId: true } });
  return clasificarGruposNoComestibles(new Map(grupos.map((g) => [g.id, { nombre: g.nombre, grupoPadreId: g.grupoPadreId }])));
}

/**
 * Equivalente de construirMapaProductosConTipo_ (Catalogo.js:1468-1499) — a
 * diferencia de Apps Script, acá se indexa por productoId real (FK), nunca
 * por nombre: elimina de raíz la clase de bugs de colisión/rename que
 * motivó renombrarProductoEnHistorial_ en el original (ya no existe nada
 * parecido que mantener sincronizado).
 *
 * `precioVenta` sale YA resuelto con el override de Precio Local (mismo
 * criterio que el original: la línea `precioVenta:
 * resolverPrecioVenta_(...)` de construirMapaProductosConTipo_ — no es el
 * global crudo, así que todo reporte que lea de este mapa (estimado de
 * ventas viejas, costo de recetas con MP "Se produce" vendida directa,
 * valor a la carta de promociones) automáticamente respeta Precio Local
 * sin tener que acordarse de resolverlo aparte.
 *
 * `sucursalId` es opcional: los reportes que son 100% de Catálogo Central
 * (huecos de catálogo, insumos sin receta) no necesitan resolver ningún
 * precio local — pasarlo de largo evita una query que no aporta nada ahí.
 */
export async function construirMapaProductos(sucursalId?: string, db: Db = prisma): Promise<Map<string, InfoProductoReporte>> {
  const [productos, preciosLocales, clasificacion] = await Promise.all([
    db.producto.findMany({ include: { categoria: true, insumo: { include: { grupo: true } }, unidadStock: true, proveedorConsignacion: true } }),
    sucursalId ? db.precioLocalProducto.findMany({ where: { sucursalId, habilitado: true } }) : Promise.resolve([]),
    cargarClasificacionNoComestibles(db),
  ]);
  const precioLocalPorProducto = new Map(preciosLocales.map((pl) => [pl.productoId, Number(pl.precio)]));

  return new Map(
    productos.map((p) => [
      p.id,
      {
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        tipo: p.tipo,
        activo: p.activo,
        seProduce: p.seProduce,
        precioVenta: precioLocalPorProducto.get(p.id) ?? Number(p.precioVenta),
        categoriaNombre: p.categoria?.nombre ?? null,
        insumoNombre: p.insumo?.nombre ?? null,
        grupoNombre: p.insumo?.grupo?.nombre ?? null,
        esNoComestible: p.insumo?.grupoId ? clasificacion.idsGrupos.has(p.insumo.grupoId) : false,
        unidadStockNombre: p.unidadStock.nombre,
        esConsignacion: p.esConsignacion,
        proveedorConsignacionNombre: p.proveedorConsignacion?.nombre ?? null,
      },
    ])
  );
}

export interface IngredienteRecetaReporte {
  insumoProductoId: string;
  insumoNombre: string;
  cantidad: number;
  unidadNombre: string;
  mermaPorcentaje: number;
}

/**
 * Equivalente de construirMapaRecetas_ (Catalogo.js:1549-1596): vigente =
 * MAX(version) por producto, derivado — un solo `findMany` ordenado
 * ascendente y un Map que se pisa solo se queda con la última versión de
 * cada producto (misma técnica que obtenerRecetaVigente pero en bloque,
 * para no hacer 1 query por producto).
 */
export async function construirIndiceRecetas(
  db: Db = prisma
): Promise<{ recetaPorProducto: Map<string, IngredienteRecetaReporte[]>; mpsEnRecetas: Set<string> }> {
  const versiones = await db.recetaVersion.findMany({
    orderBy: { version: "asc" },
    include: { ingredientes: { include: { insumoProducto: true, unidad: true } } },
  });

  const recetaPorProducto = new Map<string, IngredienteRecetaReporte[]>();
  for (const v of versiones) {
    recetaPorProducto.set(
      v.productoId,
      v.ingredientes.map((it) => ({
        insumoProductoId: it.insumoProductoId,
        insumoNombre: it.insumoProducto.nombre,
        cantidad: Number(it.cantidad),
        unidadNombre: it.unidad.nombre,
        mermaPorcentaje: Number(it.mermaPorcentaje),
      }))
    );
  }

  const mpsEnRecetas = new Set<string>();
  recetaPorProducto.forEach((items) => items.forEach((it) => mpsEnRecetas.add(it.insumoProductoId)));

  return { recetaPorProducto, mpsEnRecetas };
}

export interface CostoMP {
  precioPorUnidadStock: number;
  proveedorNombre: string | null;
  fecha: Date | null;
}

/**
 * Port de obtenerCostoActualPorMP_ (Reportes.js:1665-1698) — costo de
 * reposición = precio por unidad de stock de la COMPRA MÁS RECIENTE que
 * ESTA sucursal registró. A diferencia del bug ya documentado en Apps
 * Script (leía `ProveedoresPorProducto`, Catálogo Central compartido por
 * las 5 hosterías), acá no hay bug posible: `MovimientoStock` es LOCAL por
 * construcción (llega a través de `Seccion.sucursalId`), nunca hace falta
 * acordarse de filtrar — es la única fuente que se puede leer.
 *
 * `antesDe` opcional (docs/grounding-reportes-compras-2026-09-18.md, paso
 * 4 — impacto de un cambio de precio en el costo de las recetas): con
 * fecha, la "más reciente" es la más reciente ANTES de esa fecha, no la
 * más reciente en absoluto — para poder recalcular el costo de una receta
 * "como era antes de este período" y compararlo contra el costo de hoy.
 */
export async function obtenerCostoActualPorMP(sucursalId: string, db: Db = prisma, antesDe?: Date): Promise<Map<string, CostoMP>> {
  const compras = await db.movimientoStock.findMany({
    where: {
      proceso: "COMPRA",
      seccion: { sucursalId },
      precioPorUnidadStock: { gt: 0 },
      // Una compra anulada no fija el costo de reposición.
      operacion: { anuladaEn: null, ...(antesDe ? { fecha: { lt: antesDe } } : {}) },
    },
    orderBy: { operacion: { fecha: "desc" } },
    select: { productoId: true, precioPorUnidadStock: true, operacion: { select: { fecha: true, proveedor: { select: { nombre: true } } } } },
  });

  const map = new Map<string, CostoMP>();
  for (const c of compras) {
    if (map.has(c.productoId)) continue; // ya se quedó con la compra más reciente (orden desc)
    map.set(c.productoId, {
      precioPorUnidadStock: Number(c.precioPorUnidadStock),
      proveedorNombre: c.operacion.proveedor?.nombre ?? null,
      fecha: c.operacion.fecha,
    });
  }
  return map;
}

/** Redondeo a 3 decimales, para cantidades de stock (no plata). */
export function redondearCantidad(n: number): number {
  return Math.round(Number(n || 0) * 1000) / 1000;
}
