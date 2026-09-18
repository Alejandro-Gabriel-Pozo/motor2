import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { redondearACantidadDeUnidad, tieneStockReal } from "./transiciones";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Saldo TOTAL de un producto en una sección, sumando todos los lotes —
 * equivalente de obtenerStockMP_ (Stock.js:573-589): la validación de
 * "hay suficiente" no distingue lote, solo el FEFO (abajo) lo hace.
 *
 * A diferencia de Apps Script (HOJA_STOCK, una hoja materializada
 * mantenida a mano porque rescanear TODO Kardex en cada venta era
 * proporcional a la historia completa — Stock.js:268-294), esto es un
 * SUM real sobre el índice `@@index([productoId, seccionId, loteVencimiento])`
 * — no hace falta una tabla aparte para que sea barato.
 */
export async function calcularSaldoTotal(productoId: string, seccionId: string, db: Db = prisma): Promise<number> {
  const r = await db.movimientoStock.aggregate({ where: { productoId, seccionId }, _sum: { cantidad: true } });
  return Number(r._sum.cantidad ?? 0);
}

/** Saldo de un producto en una sección, para UN lote puntual (o el bucket "sin lote" si loteVencimiento es null) — a diferencia de calcularSaldoTotal, no suma entre lotes. Usado por Conteo Físico cuando se cuenta un lote específico. */
export async function calcularSaldoPorLote(productoId: string, seccionId: string, loteVencimiento: Date | null, db: Db = prisma): Promise<number> {
  const r = await db.movimientoStock.aggregate({ where: { productoId, seccionId, loteVencimiento }, _sum: { cantidad: true } });
  return Number(r._sum.cantidad ?? 0);
}

export interface ResultadoValidacionStock {
  ok: boolean;
  actual: number;
  requerido: number;
}

/** Port de validarStockSuficiente_ (Stock.js:591-598). */
export async function validarStockSuficiente(
  productoId: string,
  seccionId: string,
  requerido: number,
  db: Db = prisma
): Promise<ResultadoValidacionStock> {
  const actual = await calcularSaldoTotal(productoId, seccionId, db);
  return { ok: actual >= requerido, actual, requerido };
}

/**
 * Secciones (con nombre) donde este producto tiene saldo positivo — para
 * la "pista" del error de sección obligatoria (Movimientos.js:744-751,
 * "Tiene stock en: ...").
 */
export async function seccionesConStock(productoId: string, sucursalId: string, db: Db = prisma): Promise<string[]> {
  const filas = await db.movimientoStock.groupBy({
    by: ["seccionId"],
    where: { productoId, seccion: { sucursalId } },
    _sum: { cantidad: true },
  });
  const idsConStock = filas.filter((f) => Number(f._sum.cantidad ?? 0) > 0).map((f) => f.seccionId);
  if (!idsConStock.length) return [];
  const secciones = await db.seccion.findMany({ where: { id: { in: idsConStock } }, select: { nombre: true } });
  return secciones.map((s) => s.nombre);
}

/**
 * FEFO simplificado (Stock.js:403-425, IDEA-conteo-fisico-por-lote.md): el
 * lote (Fecha VTO) con saldo positivo que vence antes, para cuando una
 * salida no especifica de qué lote sale. A propósito NO reparte entre
 * varios lotes si el elegido no alcanza — asigna todo el movimiento a ese
 * único lote, misma simplificación deliberada que Apps Script.
 */
export async function obtenerLoteMasProximoAVencer(productoId: string, seccionId: string, db: Db = prisma): Promise<Date | null> {
  const grupos = await db.movimientoStock.groupBy({
    by: ["loteVencimiento"],
    where: { productoId, seccionId, loteVencimiento: { not: null } },
    _sum: { cantidad: true },
  });

  const conSaldo = grupos.filter((g) => g.loteVencimiento && Number(g._sum.cantidad ?? 0) > 0);
  if (!conSaldo.length) return null;

  conSaldo.sort((a, b) => a.loteVencimiento!.getTime() - b.loteVencimiento!.getTime());
  return conSaldo[0].loteVencimiento;
}

export interface FilaStockParaConteo {
  productoId: string;
  productoCodigo: string;
  productoNombre: string;
  unidadStockNombre: string;
  loteVencimiento: Date | null;
  saldoSistema: number;
}

/**
 * Productos con saldo != 0 en una sección, uno por (producto, lote) — la
 * precarga de la grilla de Conteo Físico (mismo criterio que "Fetch Items
 * from Warehouse" de ERPNext, `stock_reconciliation.py::get_items`: solo
 * lo que ya tiene historial de stock ahí, no el catálogo entero). Excluye
 * PV comunes (mismo filtro que registrarConteoFisico, tieneStockReal) y
 * saldo 0 — nada que verificar ahí; si hay algo real que el sistema no
 * sabe (nunca contado, sin factura), se agrega a mano en la grilla, que sí
 * admite contar sobre saldo 0.
 */
export async function listarStockParaConteo(seccionId: string, db: Db = prisma): Promise<FilaStockParaConteo[]> {
  const grupos = await db.movimientoStock.groupBy({
    by: ["productoId", "loteVencimiento"],
    where: { seccionId },
    _sum: { cantidad: true },
  });
  const conSaldo = grupos.filter((g) => Number(g._sum.cantidad ?? 0) !== 0);
  if (!conSaldo.length) return [];

  const productoIds = Array.from(new Set(conSaldo.map((g) => g.productoId)));
  const productos = await db.producto.findMany({ where: { id: { in: productoIds } }, include: { unidadStock: true } });
  const productoPorId = new Map(productos.map((p) => [p.id, p]));

  const filas: FilaStockParaConteo[] = [];
  for (const g of conSaldo) {
    const p = productoPorId.get(g.productoId);
    if (!p || !p.activo || !tieneStockReal(p.tipo, p.seProduce)) continue;
    filas.push({
      productoId: p.id,
      productoCodigo: p.codigo,
      productoNombre: p.nombre,
      unidadStockNombre: p.unidadStock.nombre,
      loteVencimiento: g.loteVencimiento,
      saldoSistema: redondearACantidadDeUnidad(Number(g._sum.cantidad ?? 0), p.unidadStock.decimales),
    });
  }

  filas.sort(
    (a, b) =>
      a.productoNombre.localeCompare(b.productoNombre, "es") ||
      (a.loteVencimiento?.getTime() ?? -Infinity) - (b.loteVencimiento?.getTime() ?? -Infinity)
  );
  return filas;
}

export interface ParteConsumo {
  productoId: string;
  loteVencimiento: Date | null;
  cantidad: number;
}

/**
 * Port de resolverConsumoPorFamilia_ (Stock.js:438-523, sesión "recetas por
 * insumo"): si el producto de la receta tiene Insumo asignado y el puntual
 * no alcanza pero el Insumo ENTERO (sumando todos los "hermanos" — otros
 * Producto con el mismo insumoId, MP, activos, en la misma sección) sí
 * cubre lo necesario, reparte el consumo entre ellos con criterio FEFO
 * (lote que vence antes primero, sin-lote al final).
 *
 * A propósito NO reparte si el Insumo entero tampoco alcanza (cae al
 * camino de siempre: todo el consumo contra el producto pedido, para que
 * el "no alcanza" downstream de validarStockSuficiente bloquee igual que
 * hoy) ni entre secciones distintas ni fuera de un producto sin Insumo.
 * Alcance a propósito acotado a consumo DE RECETA (Producción/Venta) — el
 * llamador de Consumo/Merma/Ajuste manuales nunca pasa por acá.
 */
export async function resolverConsumoPorFamilia(
  productoId: string,
  cantidadNecesaria: number,
  seccionId: string,
  db: Db = prisma,
  // Permite reusar un cache de producto por transacción (ver
  // producto-cache.ts) en vez de volver a pedir el mismo producto que el
  // llamador ya tiene — por defecto pide directo, para los llamadores que
  // no arman receta (o no les importa el round-trip extra).
  obtenerProducto: (id: string) => Promise<{ insumoId: string | null } | null> = (id) => db.producto.findUnique({ where: { id } })
): Promise<ParteConsumo[]> {
  const sinReparto = async (): Promise<ParteConsumo[]> => [
    { productoId, loteVencimiento: await obtenerLoteMasProximoAVencer(productoId, seccionId, db), cantidad: cantidadNecesaria },
  ];

  const producto = await obtenerProducto(productoId);
  if (!producto?.insumoId) return sinReparto();

  const hermanos = await db.producto.findMany({
    where: { insumoId: producto.insumoId, tipo: "MP", activo: true },
    select: { id: true },
  });
  const hermanoIds = hermanos.map((h) => h.id);
  if (!hermanoIds.length) return sinReparto();

  const lotes = await db.movimientoStock.groupBy({
    by: ["productoId", "loteVencimiento"],
    where: { productoId: { in: hermanoIds }, seccionId },
    _sum: { cantidad: true },
  });

  const candidatos = lotes
    .map((l) => ({ productoId: l.productoId, loteVencimiento: l.loteVencimiento, saldo: Number(l._sum.cantidad ?? 0) }))
    .filter((c) => c.saldo > 0)
    .sort((a, b) => {
      if (a.loteVencimiento && b.loteVencimiento) return a.loteVencimiento.getTime() - b.loteVencimiento.getTime();
      if (a.loteVencimiento) return -1; // con fecha antes que sin fecha
      if (b.loteVencimiento) return 1;
      return 0;
    });

  // Redondeado a 4 decimales (precisión real de MovimientoStock.cantidad,
  // Decimal(14,4)) ANTES de comparar — investigado como flake intermitente
  // de test/auditoria/precision-roundtrip-y-reparto.test.ts ("3 hermanos"):
  // `candidatos.reduce(...)` suma en el orden que Postgres devuelve el
  // GROUP BY (sin ORDER BY, no garantizado), y la suma de punto flotante no
  // es asociativa — sumar 3.37+2.19+1.81 en un orden distinto al que usa
  // `cantidadNecesaria` (calculado aparte por quien llama) puede aterrizar
  // en un float de IEEE754 apenas distinto (`7.3700000000000001066` vs.
  // `7.3700000000000009948`, mismo valor decimal real). Sin este redondeo,
  // ese ruido de los últimos bits hacía fallar `disponibleInsumo <
  // cantidadNecesaria` para un pedido que en realidad calzaba justo —
  // reproducido de forma determinística instrumentando el código real
  // (no en un script aislado, donde el orden del GROUP BY no variaba).
  const disponibleInsumo = redondearACantidadDeUnidad(candidatos.reduce((acc, c) => acc + c.saldo, 0), 4);
  if (disponibleInsumo < redondearACantidadDeUnidad(cantidadNecesaria, 4)) return sinReparto(); // ni el Insumo entero alcanza

  const partes: ParteConsumo[] = [];
  let restante = cantidadNecesaria;
  for (const c of candidatos) {
    if (restante <= 0) break;
    const tomar = Math.min(restante, c.saldo);
    partes.push({ productoId: c.productoId, loteVencimiento: c.loteVencimiento, cantidad: tomar });
    restante -= tomar;
  }
  return partes;
}
