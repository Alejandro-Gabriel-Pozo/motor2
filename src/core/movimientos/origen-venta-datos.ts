import type { Prisma } from "@prisma/client";
import { obtenerSeccionPropia } from "@/core/movimientos/stock";
import { whereSeccionHabitualVigente } from "@/core/stock/seccion-habitual";
import { disponibilidadDeProductos } from "@/core/catalogo/public-servidor";
import { crearLibroDeStock, type LibroDeStock, type SeccionCandidata } from "@/core/movimientos/origen-venta";

/**
 * Cargador con Prisma del origen de la venta (docs/plan-seccion-habitual-stock-2026-09-25.md, C4): arma, EN LOTE (un solo `groupBy`
 * de saldos), todo lo que el núcleo puro `origen-venta.ts` necesita para decidir de qué sección sale cada consumo.
 *
 * Dos modos (`OrigenVenta`):
 * - `seccion` (venta de mostrador): la sección la elige una persona; se valida que sea de la sucursal («No se encontró la sección.»,
 *   como siempre) y es la única candidata (habitual de todo = ella, sin respaldos).
 * - `automatico` (cierre de cuenta del POS): candidatas = las secciones activas de la sucursal; de RESPALDO, solo las marcadas
 *   `sirveDeRespaldoEnVentas` (default true: todas). Cada PV prefiere su sección HABITUAL (`SeccionHabitualProducto`), solo si apunta a
 *   una sección ACTIVA de ESTA sucursal — y se usa aunque no sirva de respaldo (la preferencia explícita manda). Si no hay ninguna activa,
 *   «Esta sucursal no tiene ninguna sección activa: pedile a un admin que cree una.» (el mismo mensaje que ya mostraba la pantalla).
 *   Sección de REFERENCIA de un producto: la de su último movimiento entre las de respaldo (`groupBy` + `_max.creadoEn`, nunca
 *   `findMany distinct`, que Prisma deduplica en memoria); decide adónde va un faltante o la fila VENTA cuando nada más lo decide.
 */

const MENSAJE_SIN_SECCIONES_ACTIVAS = "Esta sucursal no tiene ninguna sección activa: pedile a un admin que cree una.";

export type OrigenVenta = { tipo: "seccion"; seccionId: string } | { tipo: "automatico" };

/** Paso previo, ANTES de validar las líneas: resuelve las secciones candidatas o devuelve el error listo para mostrar. */
export type OrigenPreparado =
  | { ok: true; tipo: "seccion"; fija: SeccionCandidata }
  | { ok: true; tipo: "automatico"; activas: (SeccionCandidata & { sirveDeRespaldoEnVentas: boolean })[] }
  | { ok: false; mensaje: string };

export async function prepararOrigen(tx: Prisma.TransactionClient, sucursalId: string, origen: OrigenVenta): Promise<OrigenPreparado> {
  if (origen.tipo === "seccion") {
    // Fase 6 (auditoría de seguridad/contratos): conPermiso no valida que la sección sea de ESTA sucursal, solo el permiso de quien llama.
    const seccion = await obtenerSeccionPropia(origen.seccionId, sucursalId, tx);
    if (!seccion) return { ok: false, mensaje: "No se encontró la sección." };
    return { ok: true, tipo: "seccion", fija: { id: seccion.id, nombre: seccion.nombre } };
  }
  const activas = await tx.seccion.findMany({ where: { sucursalId, activa: true }, select: { id: true, nombre: true, sirveDeRespaldoEnVentas: true }, orderBy: { nombre: "asc" } });
  if (!activas.length) return { ok: false, mensaje: MENSAJE_SIN_SECCIONES_ACTIVAS };
  // Por nombre en castellano (mismo criterio que el desempate de origen-venta.ts), no por la intercalación de la base.
  activas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  return { ok: true, tipo: "automatico", activas };
}

export interface DatosDeOrigen {
  libro: LibroDeStock;
  /** El insumo y sus hermanos disponibles en la sucursal (él mismo incluido); sin insumo, solo él. */
  familiaDe(mpId: string): string[];
  /**
   * D8 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): las MP de un Insumo declarado como SUSTITUTO en alguna línea de
   * receta, ya filtradas por defensa — disponibles en la sucursal, `Insumo.activo`, y con la MISMA unidad de stock que se pide
   * (la del ingrediente principal al que sustituyen). El dedupe contra la familia principal de ESA línea lo hace el núcleo puro
   * (`asignarConsumosDeVenta`), no acá — esta función no conoce "la línea", solo el Insumo y la unidad.
   */
  familiaSustitutaDe(insumoId: string, unidadStockId: string): string[];
  /** Sección habitual del PV (en modo sección: la elegida). */
  habitualDe(pvId: string): SeccionCandidata | null;
  /** Secciones activas que sirven de respaldo automático (`sirveDeRespaldoEnVentas`; en modo sección: ninguna). */
  respaldos: SeccionCandidata[];
  /** Sección del último movimiento del producto entre las de respaldo, o null. */
  referenciaDe(productoId: string): string | null;
  /** Última opción cuando nada más decide la sección (en modo sección: la elegida; en automático: el primer respaldo por nombre). */
  seccionPorDefectoId: string;
  nombreDeSeccion(seccionId: string): string;
}

/**
 * Carga saldos por (producto, sección, lote) de todo lo que la venta puede tocar — los insumos de las recetas con sus familias y los
 * PV que se producen (stock propio) —, en las secciones candidatas.
 */
export async function cargarDatosDeOrigen(
  tx: Prisma.TransactionClient,
  sucursalId: string,
  origen: Extract<OrigenPreparado, { ok: true }>,
  pedido: { pvIds: readonly string[]; mpIds: readonly string[]; pvQueSeProducenIds: readonly string[]; insumoSustitutoIds: readonly string[] }
): Promise<DatosDeOrigen> {
  const secciones: SeccionCandidata[] = origen.tipo === "seccion" ? [origen.fija] : origen.activas.map(({ id, nombre }) => ({ id, nombre }));
  const seccionIds = secciones.map((s) => s.id);

  const [familias, sustitutas] = await Promise.all([
    cargarFamilias(tx, sucursalId, pedido.mpIds),
    cargarFamiliasSustitutas(tx, sucursalId, pedido.insumoSustitutoIds),
  ]);
  const productoIds = Array.from(new Set([...Array.from(familias.values()).flat(), ...pedido.pvQueSeProducenIds, ...sustitutas.productoIds]));
  const grupos = productoIds.length
    ? await tx.movimientoStock.groupBy({
        by: ["productoId", "seccionId", "loteVencimiento"],
        where: { productoId: { in: productoIds }, seccionId: { in: seccionIds } },
        _sum: { cantidad: true },
      })
    : [];
  const libro = crearLibroDeStock(grupos.map((g) => ({ productoId: g.productoId, seccionId: g.seccionId, loteVencimiento: g.loteVencimiento, saldo: Number(g._sum.cantidad ?? 0) })));
  const nombres = new Map(secciones.map((s) => [s.id, s.nombre]));
  const familiaDe = (mpId: string) => familias.get(mpId) ?? [mpId];

  if (origen.tipo === "seccion") {
    return {
      libro,
      familiaDe,
      familiaSustitutaDe: sustitutas.familiaSustitutaDe,
      habitualDe: () => origen.fija,
      respaldos: [],
      referenciaDe: () => null,
      seccionPorDefectoId: origen.fija.id,
      nombreDeSeccion: (id) => nombres.get(id) ?? id,
    };
  }

  const respaldos = origen.activas.filter((s) => s.sirveDeRespaldoEnVentas).map(({ id, nombre }) => ({ id, nombre }));
  const [referencias, habituales] = await Promise.all([cargarReferencias(tx, [...pedido.pvIds, ...productoIds], respaldos), cargarHabituales(tx, sucursalId, pedido.pvIds)]);
  return {
    libro,
    familiaDe,
    familiaSustitutaDe: sustitutas.familiaSustitutaDe,
    habitualDe: (pvId) => habituales.get(pvId) ?? null,
    respaldos,
    referenciaDe: (productoId) => referencias.get(productoId) ?? null,
    seccionPorDefectoId: respaldos[0]?.id ?? origen.activas[0].id,
    nombreDeSeccion: (id) => nombres.get(id) ?? id,
  };
}

/** Sección habitual de cada PV — solo las que apuntan a una sección ACTIVA de esta sucursal (cualquier otra se ignora, como si no hubiera). */
async function cargarHabituales(tx: Prisma.TransactionClient, sucursalId: string, pvIds: readonly string[]): Promise<Map<string, SeccionCandidata>> {
  if (!pvIds.length) return new Map();
  const filas = await tx.seccionHabitualProducto.findMany({
    where: { ...whereSeccionHabitualVigente(sucursalId), productoId: { in: [...pvIds] } },
    select: { productoId: true, seccion: { select: { id: true, nombre: true } } },
  });
  return new Map(filas.map((f) => [f.productoId, f.seccion]));
}

/** Sección del último movimiento de cada producto entre `respaldos` (empate: la primera por nombre). */
async function cargarReferencias(tx: Prisma.TransactionClient, productoIds: readonly string[], respaldos: readonly SeccionCandidata[]): Promise<Map<string, string>> {
  const referencias = new Map<string, string>();
  const ids = Array.from(new Set(productoIds));
  if (!ids.length || !respaldos.length) return referencias;
  const ultimos = await tx.movimientoStock.groupBy({
    by: ["productoId", "seccionId"],
    where: { productoId: { in: ids }, seccionId: { in: respaldos.map((s) => s.id) } },
    _max: { creadoEn: true },
  });
  const orden = new Map(respaldos.map((s, i) => [s.id, i]));
  const mejor = new Map<string, { seccionId: string; creadoEn: number }>();
  for (const u of ultimos) {
    const creadoEn = u._max.creadoEn?.getTime() ?? -Infinity;
    const previo = mejor.get(u.productoId);
    if (!previo || creadoEn > previo.creadoEn || (creadoEn === previo.creadoEn && orden.get(u.seccionId)! < orden.get(previo.seccionId)!)) {
      mejor.set(u.productoId, { seccionId: u.seccionId, creadoEn });
    }
  }
  for (const [productoId, m] of mejor) referencias.set(productoId, m.seccionId);
  return referencias;
}

/** Familia de cada MP (mismo criterio que `resolverConsumoPorFamilia`): con insumo, las MP de ese insumo disponibles en la sucursal. */
async function cargarFamilias(tx: Prisma.TransactionClient, sucursalId: string, mpIds: readonly string[]): Promise<Map<string, string[]>> {
  const familias = new Map<string, string[]>();
  if (!mpIds.length) return familias;
  const mps = await tx.producto.findMany({ where: { id: { in: [...mpIds] } }, select: { id: true, insumoId: true } });
  const insumoIds = Array.from(new Set(mps.flatMap((m) => (m.insumoId ? [m.insumoId] : []))));
  const candidatos = insumoIds.length ? await tx.producto.findMany({ where: { insumoId: { in: insumoIds }, tipo: "MP" }, select: { id: true, insumoId: true }, orderBy: { id: "asc" } }) : [];
  const disponibilidad = await disponibilidadDeProductos(sucursalId, candidatos.map((c) => c.id), tx);
  for (const mp of mps) {
    const hermanos = mp.insumoId ? candidatos.filter((c) => c.insumoId === mp.insumoId && disponibilidad.get(c.id)).map((c) => c.id) : [];
    familias.set(mp.id, hermanos.includes(mp.id) ? hermanos : [mp.id, ...hermanos]);
  }
  return familias;
}

/**
 * D8 (docs/plan-sustitucion-insumos-receta-2026-09-26.md): las MP de cada Insumo declarado como sustituto en ALGUNA línea de la
 * venta, EN LOTE (una sola consulta para todos, `insumoSustitutoIds` vacío = sin consulta extra), ya filtradas por defensa —
 * `Insumo.activo`, disponibles en la sucursal. La unidad de stock se filtra recién en `familiaSustitutaDe`, por llamada (cada
 * ingrediente principal puede pedir una unidad distinta) sin volver a golpear la base.
 */
async function cargarFamiliasSustitutas(
  tx: Prisma.TransactionClient,
  sucursalId: string,
  insumoSustitutoIds: readonly string[]
): Promise<{ familiaSustitutaDe: (insumoId: string, unidadStockId: string) => string[]; productoIds: string[] }> {
  const ids = Array.from(new Set(insumoSustitutoIds));
  if (!ids.length) return { familiaSustitutaDe: () => [], productoIds: [] };

  const [insumosActivos, candidatos] = await Promise.all([
    tx.insumo.findMany({ where: { id: { in: ids }, activo: true }, select: { id: true } }),
    tx.producto.findMany({ where: { insumoId: { in: ids }, tipo: "MP" }, select: { id: true, insumoId: true, unidadStockId: true }, orderBy: { id: "asc" } }),
  ]);
  const activos = new Set(insumosActivos.map((i) => i.id));
  const disponibilidad = await disponibilidadDeProductos(sucursalId, candidatos.map((c) => c.id), tx);

  const porInsumo = new Map<string, { id: string; unidadStockId: string }[]>();
  for (const c of candidatos) {
    if (!c.insumoId || !activos.has(c.insumoId) || !disponibilidad.get(c.id)) continue;
    const lista = porInsumo.get(c.insumoId) ?? [];
    lista.push({ id: c.id, unidadStockId: c.unidadStockId });
    porInsumo.set(c.insumoId, lista);
  }

  return {
    familiaSustitutaDe: (insumoId, unidadStockId) => (porInsumo.get(insumoId) ?? []).filter((p) => p.unidadStockId === unidadStockId).map((p) => p.id),
    productoIds: Array.from(porInsumo.values()).flatMap((lista) => lista.map((p) => p.id)),
  };
}
