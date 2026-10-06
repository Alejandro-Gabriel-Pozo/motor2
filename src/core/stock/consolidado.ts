import { tieneStockReal } from "@/core/movimientos/public";

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

/** Un producto del catálogo disponible en la sucursal, con lo que el reporte necesita de él. */
export interface ProductoParaConsolidado {
  id: string;
  codigo: string;
  nombre: string;
  tipo: "MP" | "PV";
  seProduce: boolean;
  unidadStock: { nombre: string };
  insumo: { nombre: string } | null;
}

/** El saldo teórico de un producto en una sección y lote (suma del Kardex). `loteVencimiento` null = sin lote. */
export interface SaldoTeorico {
  productoId: string;
  seccionId: string;
  loteVencimiento: Date | null;
  saldo: number;
}

/** Un conteo físico de una clave (producto + sección + lote). Los conteos llegan del MÁS NUEVO al más viejo. */
export interface ConteoDeClave {
  productoId: string;
  seccionId: string;
  loteVencimiento: Date | null;
  estado: string;
  fecha: Date;
  conteoReal: number;
  diferencia: number;
}

/** Un movimiento del Kardex posterior al último conteo de su clave. */
export interface MovimientoPosteriorAlConteo {
  productoId: string;
  seccionId: string;
  loteVencimiento: Date | null;
  fecha: Date;
  cantidad: number;
}

/** Qué movimientos hay que leer: los de esta clave creados DESPUÉS de `despuesDe` (la fecha de su último conteo válido). */
export interface MovimientosPorLeer {
  productoId: string;
  seccionId: string;
  loteVencimiento: Date | null;
  despuesDe: Date;
}

function claveConteo(productoId: string, seccionId: string, lote: string): string {
  return `${productoId}||${seccionId}||${lote}`;
}

/** Último conteo válido (ni DESCARTADO ni CANCELADO) por clave producto+sección+lote; `conteos` viene del más nuevo al más viejo. */
function ultimoConteoPorClave(conteos: readonly ConteoDeClave[]): Map<string, ConteoDeClave> {
  const ultimoConteo = new Map<string, ConteoDeClave>();
  for (const c of conteos) {
    if (c.estado === "DESCARTADO" || c.estado === "CANCELADO") continue;
    const key = claveConteo(c.productoId, c.seccionId, loteClave(c.loteVencimiento));
    if (!ultimoConteo.has(key)) ultimoConteo.set(key, c);
  }
  return ultimoConteo;
}

/**
 * Qué movimientos posteriores al conteo hay que leer para explicar el teórico: uno por cada clave del teórico que tiene conteo válido. Lo usa la consulta para
 * traerlos TODOS en una sola lectura (antes: una consulta por clave con conteo).
 */
export function movimientosPorLeer(teorico: readonly SaldoTeorico[], conteos: readonly ConteoDeClave[]): MovimientosPorLeer[] {
  const ultimoConteo = ultimoConteoPorClave(conteos);
  const porLeer = new Map<string, MovimientosPorLeer>();
  for (const t of teorico) {
    const key = claveConteo(t.productoId, t.seccionId, loteClave(t.loteVencimiento));
    const conteo = ultimoConteo.get(key);
    if (!conteo) continue;
    porLeer.set(key, { productoId: t.productoId, seccionId: t.seccionId, loteVencimiento: t.loteVencimiento, despuesDe: conteo.fecha });
  }
  return [...porLeer.values()];
}

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
export function armarStockConsolidado(entrada: {
  productos: readonly ProductoParaConsolidado[];
  teorico: readonly SaldoTeorico[];
  secciones: readonly { id: string; nombre: string }[];
  conteos: readonly ConteoDeClave[];
  movimientos: readonly MovimientoPosteriorAlConteo[];
}): FilaStockConsolidado[] {
  const { productos, teorico, secciones, conteos, movimientos } = entrada;
  const elegibles = productos.filter((p) => tieneStockReal(p.tipo, p.seProduce));
  const productoPorId = new Map(elegibles.map((p) => [p.id, p]));
  const seccionPorId = new Map(secciones.map((s) => [s.id, s]));
  const ultimoConteo = ultimoConteoPorClave(conteos);

  // Movimientos posteriores a cada conteo (para entradas/salidas desde el último conteo), agrupados por clave.
  const movsPorClave = new Map<string, { fecha: Date; cantidad: number }[]>();
  for (const m of movimientos) {
    const key = claveConteo(m.productoId, m.seccionId, loteClave(m.loteVencimiento));
    const lista = movsPorClave.get(key) ?? [];
    lista.push({ fecha: m.fecha, cantidad: m.cantidad });
    movsPorClave.set(key, lista);
  }

  const filas: FilaStockConsolidado[] = [];
  const productosConFila = new Set<string>();

  for (const t of teorico) {
    const producto = productoPorId.get(t.productoId);
    if (!producto) continue; // no elegible (ni MP ni PV "Se produce") o inactivo
    productosConFila.add(t.productoId);
    const seccion = seccionPorId.get(t.seccionId);
    filas.push(armarFila(producto, seccion?.id ?? null, seccion?.nombre ?? "", t.loteVencimiento, t.saldo, true, ultimoConteo, movsPorClave));
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
  ultimoConteo: ReadonlyMap<string, { conteoReal: number; diferencia: number; fecha: Date }>,
  movsPorClave: ReadonlyMap<string, { fecha: Date; cantidad: number }[]>
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
  else if (conteo.diferencia === 0) estado = "CONCILIADO";
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
    ultimoFisico: conteo ? conteo.conteoReal : null,
    fechaConteo: conteo?.fecha ?? null,
    diferencia: conteo ? conteo.diferencia : null,
    entradasDesdeConteo: entradas,
    salidasDesdeConteo: salidas,
    estado,
  };
}
