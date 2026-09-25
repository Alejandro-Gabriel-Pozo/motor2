import type { Prisma } from "@prisma/client";
import { obtenerSeccionPropia } from "@/core/movimientos/stock";
import { disponibilidadDeProductos } from "@/core/catalogo/disponibilidad-producto-consulta";
import { crearLibroDeStock, type LibroDeStock, type SeccionCandidata } from "@/core/movimientos/origen-venta";

/**
 * Cargador con Prisma del origen de la venta (docs/plan-seccion-habitual-stock-2026-09-25.md, C4): arma, EN LOTE (un solo `groupBy`
 * de saldos), todo lo que el núcleo puro `origen-venta.ts` necesita para decidir de qué sección sale cada consumo.
 *
 * Dos modos (`OrigenVenta`):
 * - `seccion` (venta de mostrador): la sección la elige una persona; se valida que sea de la sucursal («No se encontró la sección.»,
 *   como siempre) y es la única candidata (habitual de todo = ella, sin respaldos).
 * - `automatico` (cierre de cuenta del POS): candidatas = las secciones activas de la sucursal.
 */

export type OrigenVenta = { tipo: "seccion"; seccionId: string } | { tipo: "automatico" };

/** Paso previo, ANTES de validar las líneas: resuelve las secciones candidatas o devuelve el error listo para mostrar. */
export type OrigenPreparado =
  | { ok: true; tipo: "seccion"; fija: SeccionCandidata }
  | { ok: false; mensaje: string };

export async function prepararOrigen(tx: Prisma.TransactionClient, sucursalId: string, origen: OrigenVenta): Promise<OrigenPreparado> {
  if (origen.tipo === "seccion") {
    // Fase 6 (auditoría de seguridad/contratos): conPermiso no valida que la sección sea de ESTA sucursal, solo el permiso de quien llama.
    const seccion = await obtenerSeccionPropia(origen.seccionId, sucursalId, tx);
    if (!seccion) return { ok: false, mensaje: "No se encontró la sección." };
    return { ok: true, tipo: "seccion", fija: { id: seccion.id, nombre: seccion.nombre } };
  }
  throw new Error("prepararOrigen: modo automático todavía no soportado.");
}

export interface DatosDeOrigen {
  libro: LibroDeStock;
  /** El insumo y sus hermanos disponibles en la sucursal (él mismo incluido); sin insumo, solo él. */
  familiaDe(mpId: string): string[];
  /** Sección habitual del PV (en modo sección: la elegida). */
  habitualDe(pvId: string): SeccionCandidata | null;
  /** Secciones que sirven de respaldo automático (en modo sección: ninguna). */
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
  pedido: { mpIds: readonly string[]; pvQueSeProducenIds: readonly string[] }
): Promise<DatosDeOrigen> {
  const secciones = [origen.fija];
  const seccionIds = secciones.map((s) => s.id);

  const familias = await cargarFamilias(tx, sucursalId, pedido.mpIds);
  const productoIds = Array.from(new Set([...Array.from(familias.values()).flat(), ...pedido.pvQueSeProducenIds]));
  const grupos = productoIds.length
    ? await tx.movimientoStock.groupBy({
        by: ["productoId", "seccionId", "loteVencimiento"],
        where: { productoId: { in: productoIds }, seccionId: { in: seccionIds } },
        _sum: { cantidad: true },
      })
    : [];
  const libro = crearLibroDeStock(grupos.map((g) => ({ productoId: g.productoId, seccionId: g.seccionId, loteVencimiento: g.loteVencimiento, saldo: Number(g._sum.cantidad ?? 0) })));
  const nombres = new Map(secciones.map((s) => [s.id, s.nombre]));

  return {
    libro,
    familiaDe: (mpId) => familias.get(mpId) ?? [mpId],
    habitualDe: () => origen.fija,
    respaldos: [],
    referenciaDe: () => null,
    seccionPorDefectoId: origen.fija.id,
    nombreDeSeccion: (id) => nombres.get(id) ?? id,
  };
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
