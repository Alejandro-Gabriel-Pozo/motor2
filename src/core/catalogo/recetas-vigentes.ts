import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * EL embudo de la receta VIGENTE: vigente = la de mayor `version` de cada plato, siempre derivada (nunca un campo guardado). Todo lector de
 * `RecetaVersion` que elige una versiÃ³n (o el historial) pasa por acÃ¡; `test/arquitectura/lectores-de-receta.test.ts` verifica que ningÃºn
 * otro archivo lo haga por su cuenta.
 *
 * Sin `@/lib/db`: recibe `db` por parÃ¡metro (regla `publico-puro` â€” se exporta desde la fachada pura del dominio). Cada lector pone su
 * propio `include`/`select` (el SQL que corre cada uno es el mismo de siempre), y el orden en que se recorren los platos sale del
 * `orderBy: version` de la consulta, no de este archivo.
 */
type Db = PrismaClient | Prisma.TransactionClient;

type ConIncluyente<I extends Prisma.RecetaVersionInclude> = Prisma.RecetaVersionGetPayload<{ include: I }>;

/**
 * De una lista de versiones (de uno o varios platos) se queda con la de mayor `version` de cada plato. No depende del orden de entrada, y
 * el Map devuelto conserva el orden en que aparece cada plato por primera vez â€” con la lista ascendente de `cargarRecetasVigentes`, el orden
 * de las claves es el de la versiÃ³n mÃ¡s baja de cada plato (lo que recorren, por ejemplo, los reportes de diferencias).
 */
export function quedarseConLaVigente<T extends { productoId: string; version: number }>(versiones: readonly T[]): Map<string, T> {
  const vigentes = new Map<string, T>();
  for (const v of versiones) {
    const actual = vigentes.get(v.productoId);
    if (!actual || v.version > actual.version) vigentes.set(v.productoId, v);
  }
  return vigentes;
}

/** La receta vigente de CADA plato (o de los que filtre `where`) en UNA sola consulta, ordenada por versiÃ³n ascendente. */
export async function cargarRecetasVigentes<I extends Prisma.RecetaVersionInclude>(
  db: Db,
  args: { where?: Prisma.RecetaVersionWhereInput; include: I }
): Promise<Map<string, ConIncluyente<I>>> {
  const versiones = (await db.recetaVersion.findMany({ where: args.where ?? {}, orderBy: { version: "asc" }, include: args.include })) as unknown as ConIncluyente<I>[];
  return quedarseConLaVigente(versiones);
}

/** La receta vigente de UN plato (`null` si todavÃ­a no tiene ninguna). `args` es el `include` o el `select` que necesita quien lee. */
export async function cargarRecetaVigente<const A extends { include?: Prisma.RecetaVersionInclude; select?: Prisma.RecetaVersionSelect }>(
  db: Db,
  productoId: string,
  args: A
): Promise<Prisma.RecetaVersionGetPayload<A> | null> {
  return (await db.recetaVersion.findFirst({ where: { productoId }, orderBy: { version: "desc" }, ...args })) as unknown as Prisma.RecetaVersionGetPayload<A> | null;
}

/** Todas las versiones de UN plato, la mÃ¡s reciente primero (el historial â€” no la vigente). */
export async function cargarHistorialDeVersiones<I extends Prisma.RecetaVersionInclude>(db: Db, productoId: string, include: I): Promise<ConIncluyente<I>[]> {
  return (await db.recetaVersion.findMany({ where: { productoId }, orderBy: { version: "desc" }, include })) as unknown as ConIncluyente<I>[];
}

/** El nÃºmero de la versiÃ³n vigente de cada plato dado (`null` si no tiene ninguna). Sin platos, no consulta. */
export async function versionVigentePorProducto(db: Db, productoIds: readonly string[]): Promise<Map<string, number | null>> {
  if (productoIds.length === 0) return new Map();
  const vigentes = await db.recetaVersion.groupBy({ by: ["productoId"], where: { productoId: { in: [...productoIds] } }, _max: { version: true } });
  return new Map(vigentes.map((v) => [v.productoId, v._max.version]));
}

/** Filtro de `Producto`: los que tienen al menos una versiÃ³n de receta. */
export function whereConReceta() {
  return { recetaVersiones: { some: {} } } as const;
}

/** `include` de `Producto` que trae SOLO su versiÃ³n vigente (`recetaVersiones[0]`) con lo que pida `include`. */
export function incluirRecetaVigente<const I extends Prisma.RecetaVersionInclude>(include: I) {
  return { recetaVersiones: { orderBy: { version: "desc" }, take: 1, include } } as const;
}
