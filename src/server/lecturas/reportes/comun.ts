import { Prisma } from "@prisma/client";
import { clasificarGruposNoComestibles, type ClasificacionNoComestibles } from "@/core/catalogo/public";
import { preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { alcanceDeSucursal } from "@/core/catalogo/public";
import { cargarRecetasVigentes } from "@/server/lecturas/catalogo/recetas-vigentes";
import { disponibilidadDeProductos, disponibilidadEnAlgunaSucursal } from "@/server/lecturas/catalogo/disponibilidad";
import { armarIndiceRecetas, armarMapaProductos, type CostoMP, type IndiceRecetas, type InfoProductoReporte } from "@/core/reportes/public";
import type { Db } from "@/lib/db-tipos";

/**
 * Los cargadores de los reportes de costos (Pureza Fase 4, tramo A): mudados TAL CUAL desde `core/reportes/comun.ts` (mismo nombre y firma); el armado del mapa de productos y del
 * índice de recetas es puro y vive allá (`armarMapaProductos`, `armarIndiceRecetas`). Los usan la venta (el costo congelado, DENTRO de su transacción: siempre con el `tx` de quien
 * llama) y los reportes. Sin `import "server-only"`: los importan scripts con `tsx`.
 */

/** Qué grupos del árbol cuentan como «No comestibles» (una consulta chica: la tabla de Grupos es corta). */
export async function cargarClasificacionNoComestibles(db: Db): Promise<ClasificacionNoComestibles> {
  const grupos = await db.grupo.findMany({ select: { id: true, nombre: true, grupoPadreId: true } });
  return clasificarGruposNoComestibles(new Map(grupos.map((g) => [g.id, { nombre: g.nombre, grupoPadreId: g.grupoPadreId }])));
}

/**
 * El catálogo entero, crudo, tal como lo necesita `construirMapaProductos` (todos los productos con su categoría, Insumo y grupo, unidad y consignante). No
 * depende de la sucursal: el Consolidado lo lee UNA vez y arma con él el mapa de cada sucursal (O.38), y los reportes que componen varios lo comparten (O.39).
 */
export function cargarCatalogoDeProductos(db: Db) {
  return db.producto.findMany({ include: { categoria: true, insumo: { include: { grupo: true } }, unidadStock: true, proveedorConsignacion: true } });
}

/** El catálogo crudo de `cargarCatalogoDeProductos`. */
export type CatalogoDeProductos = Awaited<ReturnType<typeof cargarCatalogoDeProductos>>;

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
  clasificacionCargada?: ClasificacionNoComestibles,
  /**
   * Lo que quien llama ya leyó, para no volver a leerlo (O.38/O.39 de docs/pureza-integracion.md): el catálogo crudo (`cargarCatalogoDeProductos`, el
   * MISMO para todas las sucursales: se puede leer una vez y armar con él el mapa de cada una) y los Precios Locales vigentes de ESTA sucursal
   * (`preciosLocalesVigentes(sucursalId, db)`, sin filtro de productos: pasar los de otra sucursal, o un subconjunto, daría otros precios sin ningún
   * error). Lo que falte se lee acá, como siempre.
   *
   * `disponibilidad` (O.38b, D3): la disponibilidad de ESTA sucursal para los productos del catálogo (`disponibilidadDeProductosEnSucursales`, que el
   * Consolidado lee una vez para todas sus sucursales y reparte). Mismo cuidado que los Precios Locales: la de otra sucursal daría otra disponibilidad sin
   * ningún error. Solo tiene sentido con `sucursalId`.
   */
  cargado: { catalogo?: CatalogoDeProductos; preciosLocales?: ReadonlyMap<string, { precio: number }>; disponibilidad?: ReadonlyMap<string, boolean> } = {}
): Promise<Map<string, InfoProductoReporte>> {
  const [productos, preciosLocales, clasificacion] = await Promise.all([
    cargado.catalogo ? Promise.resolve(cargado.catalogo) : cargarCatalogoDeProductos(db),
    cargado.preciosLocales ? Promise.resolve(cargado.preciosLocales) : sucursalId ? preciosLocalesVigentes(sucursalId, db) : Promise.resolve(new Map<string, { precio: number }>()),
    clasificacionCargada ? Promise.resolve(clasificacionCargada) : cargarClasificacionNoComestibles(db),
  ]);
  const idsProductos = productos.map((p) => p.id);
  const disponibilidadPorProducto =
    cargado.disponibilidad ?? (sucursalId ? await disponibilidadDeProductos(sucursalId, idsProductos, db) : await disponibilidadEnAlgunaSucursal(idsProductos, db));

  return armarMapaProductos(productos, preciosLocales, clasificacion, disponibilidadPorProducto);
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
  const vigentes = await cargarRecetasVigentes(db, alcanceDeSucursal(sucursalId), {
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

  return armarIndiceRecetas(vigentes.values(), sucursalId);
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
 *
 * Es la de N sucursales (`obtenerCostoActualPorMPDeSucursales`) con un solo elemento: UNA implementación (O.38b de docs/pureza-integracion.md, D2).
 * La usan la venta (el costo congelado, dentro de su transacción) y los reportes de una sucursal.
 */
export async function obtenerCostoActualPorMP(sucursalId: string, db: Db, antesDe?: Date): Promise<Map<string, CostoMP>> {
  return (await obtenerCostoActualPorMPDeSucursales([sucursalId], db, antesDe)).get(sucursalId)!;
}

/**
 * `obtenerCostoActualPorMP` de VARIAS sucursales en UNA consulta (O.38b, D2 de docs/plan-hito-4-pureza.md §4): la compra más reciente de cada producto
 * EN CADA sucursal (`DISTINCT ON (sucursal, producto)`), repartida por sucursal. Cada sucursal sale en el resultado aunque no tenga compras (mapa vacío).
 * Con un solo elemento lee lo mismo que antes (`IN ($1)` es `= $1` para Postgres, y la sucursal constante no cambia ni el orden ni el desempate). El
 * Consolidado la llama con todas sus sucursales.
 */
export async function obtenerCostoActualPorMPDeSucursales(sucursalIds: readonly string[], db: Db, antesDe?: Date): Promise<Map<string, Map<string, CostoMP>>> {
  const porSucursal = new Map(sucursalIds.map((id) => [id, new Map<string, CostoMP>()]));
  // `Prisma.join` de una lista vacía no es SQL válido: sin sucursales no hay nada que leer.
  if (sucursalIds.length === 0) return porSucursal;
  // 1 fila por (sucursal, producto) (la compra más reciente), no una por compra: traer toda la historia de la sucursal con `include`
  // superaba el límite de parámetros de Prisma 7 con ~55k compras. Empate de fecha: gana el `m."id"` mayor (determinista).
  // La sucursal fija la empresa (`Seccion` y `Operacion` la comparten por FK compuesta); el aislamiento entre empresas lo
  // sigue haciendo el `db` recibido (RLS, A6).
  const compras = await db.$queryRaw<Array<{ sucursalId: string; productoId: string; precioPorUnidadStock: Prisma.Decimal; fecha: Date; proveedorNombre: string | null }>>`
    SELECT DISTINCT ON (s."sucursalId", m."productoId") s."sucursalId", m."productoId", m."precioPorUnidadStock", o."fecha", p."nombre" AS "proveedorNombre"
    FROM "MovimientoStock" m
    JOIN "Operacion" o ON o."id" = m."operacionId"
    JOIN "Seccion" s ON s."id" = m."seccionId"
    LEFT JOIN "Proveedor" p ON p."id" = o."proveedorId"
    WHERE m."proceso" = 'COMPRA' AND s."sucursalId" IN (${Prisma.join(sucursalIds)})
      AND m."precioPorUnidadStock" > 0
      AND o."anuladaEn" IS NULL
      ${antesDe ? Prisma.sql`AND o."fecha" < ${antesDe}` : Prisma.empty}
    ORDER BY s."sucursalId", m."productoId", o."fecha" DESC, m."id" DESC
  `;

  for (const c of compras) {
    porSucursal.get(c.sucursalId)?.set(c.productoId, {
      precioPorUnidadStock: Number(c.precioPorUnidadStock),
      proveedorNombre: c.proveedorNombre,
      fecha: c.fecha,
    });
  }
  return porSucursal;
}
