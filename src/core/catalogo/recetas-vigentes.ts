import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * EL embudo de la receta VIGENTE: vigente = la de mayor `version` de la serie que corresponda, siempre derivada (nunca un campo guardado).
 * Todo lector de `RecetaVersion` que elige una versión (o el historial) pasa por acá; `test/arquitectura/lectores-de-receta.test.ts`
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
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * ALCANCE de la lectura: desde qué sucursal se lee la receta. `ALCANCE_CENTRAL` lee SOLO la serie central (el editor central, la estructura
 * de la receta, el aviso «la central cambió»); `alcanceDeSucursal(id)` resuelve la receta EFECTIVA de esa sucursal (la propia si la tiene
 * habilitada, si no la central). `test/arquitectura/lectores-de-receta.test.ts` exige que cada archivo use el que le corresponde según su
 * clasificación.
 */
interface AlcanceDeReceta {
  sucursalId: string | null;
}

/** Solo la central: es lo único que aceptan las lecturas que no tienen una versión «efectiva» por sucursal (`whereConReceta`, `incluirRecetaVigente`). */
interface AlcanceCentral extends AlcanceDeReceta {
  readonly sucursalId: null;
}

export const ALCANCE_CENTRAL: AlcanceCentral = { sucursalId: null };

/** `null`/`undefined` = sin sucursal (central): quien recibe `sucursalId` opcional lo pasa tal cual. */
export function alcanceDeSucursal(sucursalId: string | null | undefined): AlcanceDeReceta {
  return { sucursalId: sucursalId ?? null };
}

type ConIncluyente<I extends Prisma.RecetaVersionInclude> = Prisma.RecetaVersionGetPayload<{ include: I }>;

/** `where` de quien llama + la serie central (`sucursalId` NULL). */
function enLaCentral(where: Prisma.RecetaVersionWhereInput | undefined): Prisma.RecetaVersionWhereInput {
  return { AND: [where ?? {}, { sucursalId: null }] };
}

/** Productos para los que la sucursal tiene la receta propia HABILITADA (filtrados por `productoIds` si se pasa). */
async function productosConRecetaPropia(db: Db, sucursalId: string, productoIds?: readonly string[]): Promise<string[]> {
  const filas = await db.recetaSucursal.findMany({
    where: { sucursalId, habilitada: true, ...(productoIds && { productoId: { in: [...productoIds] } }) },
    select: { productoId: true },
  });
  return filas.map((f) => f.productoId);
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

/**
 * La receta vigente de CADA plato (o de los que filtre `where`) en UNA sola lectura de versiones, ordenada por versión ascendente. Con una
 * sucursal, la de cada plato es la EFECTIVA: la propia donde la sucursal la tiene habilitada y la central en los demás.
 */
export async function cargarRecetasVigentes<I extends Prisma.RecetaVersionInclude>(
  db: Db,
  alcance: AlcanceDeReceta,
  args: { where?: Prisma.RecetaVersionWhereInput; include: I }
): Promise<Map<string, ConIncluyente<I>>> {
  const centrales = (await db.recetaVersion.findMany({ where: enLaCentral(args.where), orderBy: { version: "asc" }, include: args.include })) as unknown as ConIncluyente<I>[];
  const vigentes = quedarseConLaVigente(centrales);
  if (alcance.sucursalId === null) return vigentes;

  const conPropia = await productosConRecetaPropia(db, alcance.sucursalId);
  if (conPropia.length === 0) return vigentes;
  const propias = (await db.recetaVersion.findMany({
    where: { AND: [args.where ?? {}, { sucursalId: alcance.sucursalId, productoId: { in: conPropia } }] },
    orderBy: { version: "asc" },
    include: args.include,
  })) as unknown as ConIncluyente<I>[];
  for (const [productoId, propia] of quedarseConLaVigente(propias)) vigentes.set(productoId, propia);
  return vigentes;
}

/**
 * La receta vigente de UN plato (`null` si todavía no tiene ninguna). `args` es el `include` o el `select` que necesita quien lee. Con una
 * sucursal, la EFECTIVA: la propia si la tiene habilitada (y tiene versiones), si no la central.
 */
export async function cargarRecetaVigente<const A extends { include?: Prisma.RecetaVersionInclude; select?: Prisma.RecetaVersionSelect }>(
  db: Db,
  alcance: AlcanceDeReceta,
  productoId: string,
  args: A
): Promise<Prisma.RecetaVersionGetPayload<A> | null> {
  if (alcance.sucursalId !== null && (await productosConRecetaPropia(db, alcance.sucursalId, [productoId])).length > 0) {
    const propia = await db.recetaVersion.findFirst({ where: { productoId, sucursalId: alcance.sucursalId }, orderBy: { version: "desc" }, ...args });
    if (propia) return propia as unknown as Prisma.RecetaVersionGetPayload<A>;
  }
  return (await db.recetaVersion.findFirst({ where: { productoId, sucursalId: null }, orderBy: { version: "desc" }, ...args })) as unknown as Prisma.RecetaVersionGetPayload<A> | null;
}

/**
 * Todas las versiones de UNA serie de UN plato, la más reciente primero (el historial — no la vigente): la central con `ALCANCE_CENTRAL`, y con
 * una sucursal SU serie propia (aunque hoy esté deshabilitada: son el historial de lo que fue su receta).
 */
export async function cargarHistorialDeVersiones<I extends Prisma.RecetaVersionInclude>(db: Db, alcance: AlcanceDeReceta, productoId: string, include: I): Promise<ConIncluyente<I>[]> {
  return (await db.recetaVersion.findMany({ where: { productoId, sucursalId: alcance.sucursalId }, orderBy: { version: "desc" }, include })) as unknown as ConIncluyente<I>[];
}

/** El número de la versión CENTRAL vigente de cada plato dado (`null` si no tiene ninguna). Sin platos, no consulta. */
export async function versionVigentePorProducto(db: Db, _alcance: AlcanceCentral, productoIds: readonly string[]): Promise<Map<string, number | null>> {
  if (productoIds.length === 0) return new Map();
  const vigentes = await db.recetaVersion.groupBy({ by: ["productoId"], where: { productoId: { in: [...productoIds] }, sucursalId: null }, _max: { version: true } });
  return new Map(vigentes.map((v) => [v.productoId, v._max.version]));
}

/** Filtro de `Producto`: los que tienen al menos una versión de receta CENTRAL. */
export function whereConReceta(alcance: AlcanceCentral) {
  return { recetaVersiones: { some: { sucursalId: alcance.sucursalId } } } as const;
}

/** `include` de `Producto` que trae SOLO su versión central vigente (`recetaVersiones[0]`) con lo que pida `include`. */
export function incluirRecetaVigente<const I extends Prisma.RecetaVersionInclude>(_alcance: AlcanceCentral, include: I) {
  return { recetaVersiones: { where: { sucursalId: null }, orderBy: { version: "desc" }, take: 1, include } } as const;
}

/**
 * De los `productoIds` (o de todos, sin lista) y las `sucursalIds`, los pares (sucursal, producto) con la receta propia HABILITADA, como
 * `"<sucursalId>:<productoId>"`. Lo usan los reportes que miran la estructura central y tienen que saber en qué sucursales no rige.
 */
export async function cargarRecetasPropiasHabilitadas(db: Db, sucursalIds: readonly string[], productoIds?: readonly string[]): Promise<Set<string>> {
  if (sucursalIds.length === 0) return new Set();
  const filas = await db.recetaSucursal.findMany({
    where: { habilitada: true, sucursalId: { in: [...sucursalIds] }, ...(productoIds && { productoId: { in: [...productoIds] } }) },
    select: { sucursalId: true, productoId: true },
  });
  return new Set(filas.map((f) => `${f.sucursalId}:${f.productoId}`));
}
