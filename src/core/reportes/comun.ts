import { rendimientoEfectivo } from "@/core/catalogo/public";
import type { ClasificacionNoComestibles } from "@/core/catalogo/public";

/**
 * Lo PURO de los reportes de costos (Pureza Fase 4, tramo A): los tipos del catálogo y del índice de recetas, y cómo se ARMAN el mapa de productos y el índice de recetas a partir
 * de las filas ya leídas. Los cargadores con base (`construirMapaProductos`, `construirIndiceRecetas`, `obtenerCostoActualPorMP`, `cargarClasificacionNoComestibles`) viven en
 * `server/lecturas/reportes/comun.ts` y las usan la venta (el costo congelado) y los reportes.
 */

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

/** Una fila de producto con lo que el mapa necesita (la forma del `findMany` con `categoria`, `insumo.grupo`, `unidadStock` y `proveedorConsignacion`). */
export interface FilaDeProductoParaReporte {
  id: string;
  codigo: string;
  nombre: string;
  tipo: "MP" | "PV";
  seProduce: boolean;
  precioVenta: unknown;
  categoriaId: string | null;
  categoria: { nombre: string } | null;
  insumo: { nombre: string; grupoId: string | null; grupo: { nombre: string } | null } | null;
  unidadStock: { nombre: string };
  esConsignacion: boolean;
  proveedorConsignacion: { nombre: string } | null;
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
export function armarMapaProductos(
  productos: readonly FilaDeProductoParaReporte[],
  preciosLocales: ReadonlyMap<string, { precio: number }>,
  clasificacion: ClasificacionNoComestibles,
  disponibilidadPorProducto: ReadonlyMap<string, boolean>
): Map<string, InfoProductoReporte> {
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

/** La receta vigente de un producto con lo que el índice necesita (la forma del `findMany` con `insumoProducto`, `unidad` y `rendimientosLocales`). */
export interface RecetaVigenteParaReporte {
  productoId: string;
  ingredientes: readonly {
    id: string;
    insumoProductoId: string;
    insumoProducto: { nombre: string };
    unidad: { nombre: string };
    cantidad: unknown;
    mermaPorcentaje: unknown;
    rendimientosLocales: readonly { sucursalId: string; cantidad: unknown; mermaPorcentaje: unknown }[];
  }[];
}

/**
 * Arma el índice de recetas desde las recetas vigentes ya leídas. Con `sucursalId`, `cantidad`/`mermaPorcentaje` salen EFECTIVOS (con el override de esa sucursal si lo hay,
 * `rendimientoEfectivo`); sin ella, quedan en el valor CENTRAL.
 */
export function armarIndiceRecetas(vigentes: Iterable<RecetaVigenteParaReporte>, sucursalId?: string): IndiceRecetas {
  const recetaPorProducto = new Map<string, IngredienteRecetaReporte[]>();
  for (const v of vigentes) {
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

