import type { Prisma } from "@prisma/client";

/**
 * EL embudo de la receta VIGENTE: vigente = la de mayor `version` de la serie que corresponda, siempre derivada (nunca un campo guardado).
 * Todo lector de `RecetaVersion` que elige una versión (o el historial) pasa por acá (la lectura con base, en `server/lecturas/catalogo/recetas-vigentes.ts`; las reglas puras —el alcance, quedarse con la vigente, los filtros—, acá); `test/arquitectura/lectores-de-receta.test.ts`
 * verifica que ningún otro archivo lo haga por su cuenta.
 *
 * Hay DOS series de versiones por producto (ADR-009, familia override): la CENTRAL (`sucursalId` NULL, la de toda la empresa) y, opcionalmente,
 * una PROPIA por sucursal (`sucursalId` = la sucursal), cada una numerada por su cuenta. La receta EFECTIVA de una sucursal es la vigente de su
 * serie propia si `RecetaSucursal.habilitada`, y si no la vigente de la central (más las calibraciones por sucursal, que el lector aplica con
 * `rendimientoEfectivo`; sobre una receta propia no hay calibraciones: cuelgan de las líneas de la central).
 *
 * Sin `@/lib/db`: recibe `db` por parámetro (regla `publico-puro` — se exporta desde la fachada pura del dominio). Cada lector pone su
 * propio `include`/`select` (el SQL que corre cada uno es el mismo de siempre), y el orden en que se recorren los platos sale del
 * `orderBy: version` de la consulta, no de este archivo.
 */
/**
 * ALCANCE de la lectura: desde qué sucursal se lee la receta. `ALCANCE_CENTRAL` lee SOLO la serie central (el editor central, la estructura
 * de la receta, el aviso «la central cambió»); `alcanceDeSucursal(id)` resuelve la receta EFECTIVA de esa sucursal (la propia si la tiene
 * habilitada, si no la central). `test/arquitectura/lectores-de-receta.test.ts` exige que cada archivo use el que le corresponde según su
 * clasificación.
 */
export interface AlcanceDeReceta {
  sucursalId: string | null;
}

/** Solo la central: es lo único que aceptan las lecturas que no tienen una versión «efectiva» por sucursal (`whereConReceta`, `incluirRecetaVigente`). */
export interface AlcanceCentral extends AlcanceDeReceta {
  readonly sucursalId: null;
}

export const ALCANCE_CENTRAL: AlcanceCentral = { sucursalId: null };

/** `null`/`undefined` = sin sucursal (central): quien recibe `sucursalId` opcional lo pasa tal cual. */
export function alcanceDeSucursal(sucursalId: string | null | undefined): AlcanceDeReceta {
  return { sucursalId: sucursalId ?? null };
}

/**
 * De una lista de versiones (de uno o varios platos) se queda con la de mayor `version` de cada plato. No depende del orden de entrada, y
 * el Map devuelto conserva el orden en que aparece cada plato por primera vez — con la lista ascendente de `cargarRecetasVigentes`, el orden
 * de las claves es el de la versión más baja de cada plato (lo que recorren, por ejemplo, los reportes de diferencias).
 * Recibe versiones de UNA sola serie: mezclar la central con la propia compararía números de series distintas.
 */
export function quedarseConLaVigente<T extends { productoId: string; version: number }>(versiones: readonly T[]): Map<string, T> {
  const vigentes = new Map<string, T>();
  for (const v of versiones) {
    const actual = vigentes.get(v.productoId);
    if (!actual || v.version > actual.version) vigentes.set(v.productoId, v);
  }
  return vigentes;
}

/** Filtro de `Producto`: los que tienen al menos una versión de receta CENTRAL. */
export function whereConReceta(alcance: AlcanceCentral) {
  return { recetaVersiones: { some: { sucursalId: alcance.sucursalId } } } as const;
}

/** `include` de `Producto` que trae SOLO su versión central vigente (`recetaVersiones[0]`) con lo que pida `include`. */
export function incluirRecetaVigente<const I extends Prisma.RecetaVersionInclude>(_alcance: AlcanceCentral, include: I) {
  return { recetaVersiones: { where: { sucursalId: null }, orderBy: { version: "desc" }, take: 1, include } } as const;
}
