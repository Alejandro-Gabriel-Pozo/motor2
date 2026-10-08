import type { Prisma, PrismaClient } from "@prisma/client";
import { quedarseConLaVigente, type AlcanceCentral, type AlcanceDeReceta } from "@/core/catalogo/public";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * EL lector de la receta VIGENTE (Pureza Fase 4, tramo A): mudado TAL CUAL desde `core/catalogo/recetas-vigentes.ts` (mismo nombre y firma). Hay DOS series de versiones por producto (ADR-009,
 * familia override): la CENTRAL y, opcionalmente, una PROPIA por sucursal; ver el docstring de `core/catalogo/recetas-vigentes.ts` (el alcance y las reglas puras). Lo usan la venta (dentro de su
 * transacción), los reportes y las pantallas; `test/arquitectura/lectores-de-receta.test.ts` verifica que ningún otro archivo elija una versión por su cuenta. Sin `import "server-only"`: los
 * importan scripts con `tsx` y Playwright.
 */

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

/**
 * ¿El producto tiene ALGUNA versión de receta, central o propia de una sucursal? Una existencia y nada más (no elige ninguna versión): la pregunta «¿tiene historia?» de
 * `historia-de-producto.ts` (CAT-1, S-05): una receta ya expresa cantidades en la unidad de stock del producto, y por la regla del embudo solo este archivo lee `RecetaVersion`.
 */
export async function productoTieneRecetas(db: Db, productoId: string): Promise<boolean> {
  return (await db.recetaVersion.findFirst({ where: { productoId }, select: { id: true } })) !== null;
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
