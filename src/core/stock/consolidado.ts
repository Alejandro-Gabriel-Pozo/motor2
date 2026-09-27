import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { tieneStockReal } from "@/core/movimientos/public";
import { whereDisponibleEn } from "@/core/catalogo/public-servidor";

type Db = PrismaClient | Prisma.TransactionClient;

export type EstadoStockConsolidado = "NEGATIVO" | "SIN_MOVIMIENTOS" | "SIN_CONTEO" | "CONCILIADO" | "CON_DESVIO";

export interface FilaStockConsolidado {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  insumoNombre: string | null;
  seccionId: string | null;
  seccionNombre: string;
  loteVencimiento: string;
  unidadStockNombre: string;
  teorico: number;
  ultimoFisico: number | null;
  fechaConteo: Date | null;
  diferencia: number | null;
  entradasDesdeConteo: number;
  salidasDesdeConteo: number;
  estado: EstadoStockConsolidado;
}

const ORDEN_ESTADO: Record<EstadoStockConsolidado, number> = {
  NEGATIVO: 0,
  CON_DESVIO: 1,
  SIN_CONTEO: 2,
  SIN_MOVIMIENTOS: 3,
  CONCILIADO: 4,
};

/**
 * Port de calcularStockConsolidado_ (Stock.js:692-794) — a diferencia de
 * calcularStockActual_ (el libro mayor, solo conoce productos que YA
 * tuvieron algún movimiento), esto hace un LEFT JOIN contra el catálogo
 * completo: todo producto elegible (MP, o PV "Se produce") aparece, tenga
 * o no movimientos, tenga o no conteo — "el fix" que documenta el propio
 * Apps Script (antes un producto recién dado de alta "desaparecía" del
 * stock).
 *
 * "Diferencia Detectada" es la del ÚLTIMO conteo físico (histórica, se
 * congela) — no "teórico actual − físico actual" (eso siempre daría 0
 * después de un ajuste). Entradas/salidas DESDE ese conteo explican por
 * qué el teórico de hoy ya no es el número que se contó ese día.
 */
export async function calcularStockConsolidado(sucursalId: string, db: Db = prisma): Promise<FilaStockConsolidado[]> {
  const productos = await db.producto.findMany({
    where: whereDisponibleEn(sucursalId),
    include: { unidadStock: true, insumo: true },
  });
  const elegibles = productos.filter((p) => tieneStockReal(p.tipo, p.seProduce));
  const productoPorId = new Map(elegibles.map((p) => [p.id, p]));

  const teorico = await db.movimientoStock.groupBy({
    by: ["productoId", "seccionId", "loteVencimiento"],
    where: { producto: whereDisponibleEn(sucursalId), seccion: { sucursalId } },
    _sum: { cantidad: true },
  });

  const secciones = await db.seccion.findMany({ where: { sucursalId } });
  const seccionPorId = new Map(secciones.map((s) => [s.id, s]));

  // Último conteo válido (ni DESCARTADO ni CANCELADO) por clave producto+sección+lote.
  const conteos = await db.conteoFisico.findMany({
    where: { sucursalId },
    orderBy: { fecha: "desc" },
  });
  const claveConteo = (productoId: string, seccionId: string, lote: string) => `${productoId}||${seccionId}||${lote}`;
  const ultimoConteo = new Map<string, (typeof conteos)[number]>();
  for (const c of conteos) {
    if (c.estado === "DESCARTADO" || c.estado === "CANCELADO") continue;
    const key = claveConteo(c.productoId, c.seccionId, loteClave(c.loteVencimiento));
    if (!ultimoConteo.has(key)) ultimoConteo.set(key, c);
  }

  // Movimientos posteriores a cada conteo (para entradas/salidas desde el
  // último conteo) — una query por clave con conteo, no una sola: el join
  // real (WHERE (producto,sección,lote,fecha) IN (...)) necesitaría SQL
  // crudo por la clave compuesta; para el volumen esperado (un negocio,
  // no miles de claves con conteo a la vez) el costo es aceptable.
  const movsPorClave = new Map<string, { fecha: Date; cantidad: number }[]>();
  for (const t of teorico) {
    const key = claveConteo(t.productoId, t.seccionId, loteClave(t.loteVencimiento));
    const conteo = ultimoConteo.get(key);
    if (!conteo) continue;
    const movs = await db.movimientoStock.findMany({
      where: { productoId: t.productoId, seccionId: t.seccionId, loteVencimiento: t.loteVencimiento, creadoEn: { gt: conteo.fecha } },
      select: { creadoEn: true, cantidad: true },
    });
    movsPorClave.set(key, movs.map((m) => ({ fecha: m.creadoEn, cantidad: Number(m.cantidad) })));
  }

  const filas: FilaStockConsolidado[] = [];
  const productosConFila = new Set<string>();

  for (const t of teorico) {
    const producto = productoPorId.get(t.productoId);
    if (!producto) continue; // no elegible (ni MP ni PV "Se produce") o inactivo
    productosConFila.add(t.productoId);
    const seccion = seccionPorId.get(t.seccionId);
    filas.push(
      armarFila(producto, seccion?.id ?? null, seccion?.nombre ?? "", t.loteVencimiento, Number(t._sum.cantidad ?? 0), true, ultimoConteo, movsPorClave)
    );
  }

  // Productos elegibles sin ningún movimiento todavía — no desaparecen del reporte.
  for (const producto of elegibles) {
    if (productosConFila.has(producto.id)) continue;
    filas.push(armarFila(producto, null, "", null, 0, false, ultimoConteo, movsPorClave));
  }

  return filas.sort(
    (a, b) =>
      ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] ||
      a.productoNombre.localeCompare(b.productoNombre) ||
      a.seccionNombre.localeCompare(b.seccionNombre)
  );
}

function loteClave(lote: Date | null): string {
  return lote ? lote.toISOString().slice(0, 10) : "";
}

function armarFila(
  producto: { id: string; codigo: string; nombre: string; unidadStock: { nombre: string }; insumo: { nombre: string } | null },
  seccionId: string | null,
  seccionNombre: string,
  loteVencimiento: Date | null,
  saldoTeorico: number,
  tuvoMovimientos: boolean,
  ultimoConteo: Map<string, { conteoReal: Prisma.Decimal; diferencia: Prisma.Decimal; fecha: Date }>,
  movsPorClave: Map<string, { fecha: Date; cantidad: number }[]>
): FilaStockConsolidado {
  const lote = loteClave(loteVencimiento);
  const key = `${producto.id}||${seccionId ?? ""}||${lote}`;
  const conteo = ultimoConteo.get(key) ?? null;

  let entradas = 0;
  let salidas = 0;
  if (conteo) {
    for (const m of movsPorClave.get(key) ?? []) {
      if (m.cantidad >= 0) entradas += m.cantidad;
      else salidas += Math.abs(m.cantidad);
    }
  }

  let estado: EstadoStockConsolidado;
  if (saldoTeorico < 0) estado = "NEGATIVO";
  else if (!tuvoMovimientos) estado = "SIN_MOVIMIENTOS";
  else if (!conteo) estado = "SIN_CONTEO";
  else if (Number(conteo.diferencia) === 0) estado = "CONCILIADO";
  else estado = "CON_DESVIO";

  return {
    productoId: producto.id,
    productoCodigo: producto.codigo,
    productoNombre: producto.nombre,
    insumoNombre: producto.insumo?.nombre ?? null,
    seccionId,
    seccionNombre,
    loteVencimiento: lote,
    unidadStockNombre: producto.unidadStock.nombre,
    teorico: saldoTeorico,
    ultimoFisico: conteo ? Number(conteo.conteoReal) : null,
    fechaConteo: conteo?.fecha ?? null,
    diferencia: conteo ? Number(conteo.diferencia) : null,
    entradasDesdeConteo: entradas,
    salidasDesdeConteo: salidas,
    estado,
  };
}
