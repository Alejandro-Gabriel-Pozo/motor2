import { Prisma, type PrismaClient } from "@prisma/client";
import { cargarRecetasVigentes, clasificarGruposNoComestibles, rendimientoEfectivo, type ClasificacionNoComestibles } from "@/core/catalogo/public";
import { disponibilidadDeProductos, disponibilidadEnAlgunaSucursal, preciosLocalesVigentes } from "@/core/catalogo/public-servidor";

export type Db = PrismaClient | Prisma.TransactionClient;

export interface InfoProductoReporte {
  id: string;
  codigo: string;
  nombre: string;
  tipo: "MP" | "PV";
  /**
   * Disponible EN LA SUCURSAL de `sucursalId` (docs/plan-disponibilidad-por-sucursal-2026-09-23.md) — ya no es el
   * `Producto.activo` global. Sin `sucursalId` (reportes 100% de Catálogo Central, ver docstring de `construirMapaProductos`) es
   * "disponible en ALGUNA sucursal" (decisión del dueño, 2026-10-01; el mismo criterio que `whereDisponibleEnAlguna`): un producto
   * sin ninguna fila disponible sale `false`, ya no un `true` fijo.
   */
  disponible: boolean;
  seProduce: boolean;
  precioVenta: number;
  categoriaNombre: string | null;
  /** La categoría del producto: con ella se resuelve su food cost objetivo (`resolverObjetivoFoodCost`). */
  categoriaId: string | null;
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
export async function cargarClasificacionNoComestibles(db: Db): Promise<ClasificacionNoComestibles> {
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
 * Sin él, `InfoProductoReporte.disponible` es "disponible en alguna
 * sucursal" (una consulta chica, no por sucursal) — ver su docstring.
 */
export async function construirMapaProductos(
  sucursalId: string | undefined,
  db: Db,
  /** La clasificación de grupos "No comestibles" ya cargada, para no volver a leerla (ver `obtenerReportePorPeriodoConCatalogo`). */
  clasificacionCargada?: ClasificacionNoComestibles
): Promise<Map<string, InfoProductoReporte>> {
  const [productos, preciosLocales, clasificacion] = await Promise.all([
    db.producto.findMany({ include: { categoria: true, insumo: { include: { grupo: true } }, unidadStock: true, proveedorConsignacion: true } }),
    sucursalId ? preciosLocalesVigentes(sucursalId, db) : Promise.resolve(new Map<string, { precio: number }>()),
    clasificacionCargada ? Promise.resolve(clasificacionCargada) : cargarClasificacionNoComestibles(db),
  ]);
  const idsProductos = productos.map((p) => p.id);
  const disponibilidadPorProducto = sucursalId
    ? await disponibilidadDeProductos(sucursalId, idsProductos, db)
    : await disponibilidadEnAlgunaSucursal(idsProductos, db);

  return new Map(
    productos.map((p) => [
      p.id,
      {
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        tipo: p.tipo,
        disponible: disponibilidadPorProducto.get(p.id) === true,
        seProduce: p.seProduce,
        precioVenta: preciosLocales.get(p.id)?.precio ?? Number(p.precioVenta),
        categoriaNombre: p.categoria?.nombre ?? null,
        categoriaId: p.categoriaId,
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
  recetaIngredienteId: string;
  insumoProductoId: string;
  insumoNombre: string;
  /** EFECTIVO — el valor central, salvo que `sucursalId` tenga una calibración local (rendimientoEfectivo). */
  cantidad: number;
  unidadNombre: string;
  /** EFECTIVO — ver `cantidad`. */
  mermaPorcentaje: number;
  /** El valor del Catálogo Central, SIN calibrar — para mostrar "(calibrado acá; central: X)" en la UI. */
  cantidadCentral: number;
  mermaPorcentajeCentral: number;
  /** true si ESTA sucursal calibró cantidad y/o merma de esta línea (sin `sucursalId`, siempre false). */
  calibradoLocal: boolean;
}

export interface IndiceRecetas {
  recetaPorProducto: Map<string, IngredienteRecetaReporte[]>;
  mpsEnRecetas: Set<string>;
  /** La sucursal con la que se resolvió `cantidad`/`mermaPorcentaje` — `null` = valores centrales, sin calibrar (quien solo
   * usa la estructura, ver el docstring de `construirIndiceRecetas`). Guarda contra pasar este índice a un cálculo de OTRA
   * sucursal (ver `calcularCostosYMargenes`/`calcularImpactoRecetasPorPeriodo`/`reconstruirCostosDeVenta`). */
  sucursalId: string | null;
}

/**
 * Equivalente de construirMapaRecetas_ (Catalogo.js:1549-1596): vigente =
 * MAX(version) por producto, derivado — un solo `findMany` ordenado
 * ascendente y `cargarRecetasVigentes` (core/catalogo/recetas-vigentes.ts) se
 * queda con la última versión de cada producto, en bloque, para no hacer
 * 1 query por producto.
 *
 * `sucursalId` (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, D2/R1): con ella, `cantidad`/`mermaPorcentaje`
 * salen EFECTIVOS (con el override de esa sucursal si lo hay); sin ella, quedan en el valor CENTRAL — para quien solo
 * necesita la estructura de la receta (huecos de catálogo, insumos sin receta), sin resolver ningún override.
 * El `include` anidado de `rendimientosLocales` no suma una consulta más (sigue siendo un solo `recetaVersion.findMany`,
 * ver test/reportes/catalogo-una-sola-carga.test.ts).
 */
export async function construirIndiceRecetas(db: Db, sucursalId?: string): Promise<IndiceRecetas> {
  const vigentes = await cargarRecetasVigentes(db, {
    include: {
      ingredientes: {
        include: {
          insumoProducto: true,
          unidad: true,
          // Sin sucursalId, este where nunca matchea ninguna fila real (cuid válido nunca es "") — el include queda
          // siempre presente (mismo shape de tipos en las dos ramas), pero vacío.
          rendimientosLocales: { where: { sucursalId: sucursalId ?? "" } },
        },
      },
    },
  });

  const recetaPorProducto = new Map<string, IngredienteRecetaReporte[]>();
  for (const v of vigentes.values()) {
    recetaPorProducto.set(
      v.productoId,
      v.ingredientes.map((it) => {
        const cantidadCentral = Number(it.cantidad);
        const mermaPorcentajeCentral = Number(it.mermaPorcentaje);
        const ef = sucursalId
          ? rendimientoEfectivo(
              { cantidad: cantidadCentral, mermaPorcentaje: mermaPorcentajeCentral },
              it.rendimientosLocales.map((r) => ({
                sucursalId: r.sucursalId,
                cantidad: r.cantidad !== null ? Number(r.cantidad) : null,
                mermaPorcentaje: r.mermaPorcentaje !== null ? Number(r.mermaPorcentaje) : null,
              })),
              sucursalId
            )
          : { cantidad: cantidadCentral, mermaPorcentaje: mermaPorcentajeCentral, calibrado: false };
        return {
          recetaIngredienteId: it.id,
          insumoProductoId: it.insumoProductoId,
          insumoNombre: it.insumoProducto.nombre,
          cantidad: ef.cantidad,
          unidadNombre: it.unidad.nombre,
          mermaPorcentaje: ef.mermaPorcentaje,
          cantidadCentral,
          mermaPorcentajeCentral,
          calibradoLocal: ef.calibrado,
        };
      })
    );
  }

  const mpsEnRecetas = new Set<string>();
  recetaPorProducto.forEach((items) => items.forEach((it) => mpsEnRecetas.add(it.insumoProductoId)));

  return { recetaPorProducto, mpsEnRecetas, sucursalId: sucursalId ?? null };
}

/** Lanza si `indiceRecetas` viene de OTRA sucursal — defensa en profundidad para todo cálculo que lo reciba ya cargado
 * desde afuera (ver `calcularCostosYMargenes`/`calcularImpactoRecetasPorPeriodo`/`reconstruirCostosDeVenta`): pasar el de
 * una sucursal para calcular la de otra daría costos/rendimientos de la sucursal equivocada, sin ningún error visible. */
export function asegurarIndiceRecetasDeLaSucursal(indiceRecetas: IndiceRecetas, sucursalId: string): void {
  if (indiceRecetas.sucursalId !== sucursalId) {
    throw new Error(`indiceRecetas es de la sucursal "${indiceRecetas.sucursalId ?? "(central, sin calibrar)"}", se pidió "${sucursalId}".`);
  }
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
export async function obtenerCostoActualPorMP(sucursalId: string, db: Db, antesDe?: Date): Promise<Map<string, CostoMP>> {
  // 1 fila por producto (la compra más reciente), no una por compra: traer toda la historia de la sucursal con `include`
  // superaba el límite de parámetros de Prisma 7 con ~55k compras. Empate de fecha: gana el `m."id"` mayor (determinista).
  // La sucursal fija la empresa (`Seccion` y `Operacion` la comparten por FK compuesta); el aislamiento entre empresas lo
  // sigue haciendo el `db` recibido (RLS, A6).
  const compras = await db.$queryRaw<Array<{ productoId: string; precioPorUnidadStock: Prisma.Decimal; fecha: Date; proveedorNombre: string | null }>>`
    SELECT DISTINCT ON (m."productoId") m."productoId", m."precioPorUnidadStock", o."fecha", p."nombre" AS "proveedorNombre"
    FROM "MovimientoStock" m
    JOIN "Operacion" o ON o."id" = m."operacionId"
    JOIN "Seccion" s ON s."id" = m."seccionId"
    LEFT JOIN "Proveedor" p ON p."id" = o."proveedorId"
    WHERE m."proceso" = 'COMPRA' AND s."sucursalId" = ${sucursalId}
      AND m."precioPorUnidadStock" > 0
      AND o."anuladaEn" IS NULL
      ${antesDe ? Prisma.sql`AND o."fecha" < ${antesDe}` : Prisma.empty}
    ORDER BY m."productoId", o."fecha" DESC, m."id" DESC
  `;

  const map = new Map<string, CostoMP>();
  for (const c of compras) {
    map.set(c.productoId, {
      precioPorUnidadStock: Number(c.precioPorUnidadStock),
      proveedorNombre: c.proveedorNombre,
      fecha: c.fecha,
    });
  }
  return map;
}

/** Redondeo a 3 decimales, para cantidades de stock (no plata). */
export function redondearCantidad(n: number): number {
  return Math.round(Number(n || 0) * 1000) / 1000;
}
