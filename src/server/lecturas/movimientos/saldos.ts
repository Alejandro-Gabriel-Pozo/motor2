import type { Prisma, PrismaClient } from "@prisma/client";
import { elegirLoteMasProximoAVencer, repartirConsumoPorFamilia, type ParteDeReparto } from "@/core/movimientos/public";
import { disponibilidadDeProductos } from "@/server/lecturas/catalogo/disponibilidad";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Lectores del saldo del Kardex (Pureza Fase 4, tramo A): saldo por producto, sección y lote, sección propia, FEFO y reparto por familia. Mudados TAL CUAL desde
 * `core/movimientos/stock.ts` (mismo nombre y misma firma). SIN `import "server-only"` a propósito: los importan un spec de Playwright (`conteo-fisico-grilla`) y un
 * script de benchmark que corre con `tsx`, donde ese módulo revienta (mismo criterio que las lecturas de la carta y de los reportes).
 */

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
export async function calcularSaldoTotal(productoId: string, seccionId: string, db: Db): Promise<number> {
  const r = await db.movimientoStock.aggregate({ where: { productoId, seccionId }, _sum: { cantidad: true } });
  return Number(r._sum.cantidad ?? 0);
}

/** Saldo de un producto en una sección, para UN lote puntual (o el bucket "sin lote" si loteVencimiento es null) — a diferencia de calcularSaldoTotal, no suma entre lotes. Usado por Conteo Físico cuando se cuenta un lote específico. */
export async function calcularSaldoPorLote(productoId: string, seccionId: string, loteVencimiento: Date | null, db: Db): Promise<number> {
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
  db: Db
): Promise<ResultadoValidacionStock> {
  const actual = await calcularSaldoTotal(productoId, seccionId, db);
  return { ok: actual >= requerido, actual, requerido };
}

/**
 * Secciones (con nombre) donde este producto tiene saldo positivo — para
 * la "pista" del error de sección obligatoria (Movimientos.js:744-751,
 * "Tiene stock en: ...").
 */
export async function seccionesConStock(productoId: string, sucursalId: string, db: Db): Promise<string[]> {
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
 * Sección propia de la sucursal indicada, o `null` si no existe o
 * pertenece a otra — chequeo obligatorio antes de usar cualquier
 * `seccionId` que llegue del cliente en una mutación de stock.
 *
 * Hallazgo de auditoría (Fase 6, seguridad/contratos):
 * `conPermiso(accionClave, ...)` valida que el usuario tenga el permiso
 * en SU sucursal, nunca que la sección que mandó el cliente sea
 * realmente de esa sucursal — sin este chequeo, un usuario con permiso
 * legítimo en su propia sucursal podía mandar el `seccionId` de OTRA
 * sucursal y el sistema escribía el movimiento ahí igual, corrompiendo
 * el Kardex de un local al que no pertenece. Mismo criterio que ya
 * usaban `stock-minimo.ts`/`secciones.ts` (chequeo inline) y
 * `traspasos.ts` (copia local de esta misma función) — centralizado acá
 * para no repetirlo divergente una cuarta vez.
 */
export async function obtenerSeccionPropia(seccionId: string, sucursalId: string, db: Db) {
  const seccion = await db.seccion.findUnique({ where: { id: seccionId } });
  if (!seccion || seccion.sucursalId !== sucursalId) return null;
  return seccion;
}

/**
 * FEFO simplificado (Stock.js:403-425, IDEA-conteo-fisico-por-lote.md): el
 * lote (Fecha VTO) con saldo positivo que vence antes, para cuando una
 * salida no especifica de qué lote sale. A propósito NO reparte entre
 * varios lotes si el elegido no alcanza — asigna todo el movimiento a ese
 * único lote, misma simplificación deliberada que Apps Script.
 *
 * Ya no lo usa la VENTA (mostrador ni cierre del POS): ahí el lote lo elige el libro de `origen-venta.ts`, que descuenta lo ya asignado
 * entre líneas de la misma venta (docs/plan-seccion-habitual-stock-2026-09-25.md). Lo siguen usando Producción y el Consumo manual.
 */
export async function obtenerLoteMasProximoAVencer(productoId: string, seccionId: string, db: Db): Promise<Date | null> {
  const grupos = await db.movimientoStock.groupBy({
    by: ["loteVencimiento"],
    where: { productoId, seccionId, loteVencimiento: { not: null } },
    _sum: { cantidad: true },
  });

  return elegirLoteMasProximoAVencer(grupos.map((g) => ({ loteVencimiento: g.loteVencimiento, saldo: Number(g._sum.cantidad ?? 0) })));
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
 * Alcance a propósito acotado a consumo DE RECETA — el
 * llamador de Consumo/Merma/Ajuste manuales nunca pasa por acá.
 *
 * Hoy lo usa SOLO Producción: la venta (mostrador y cierre del POS) asigna con el libro de `origen-venta.ts`
 * (docs/plan-seccion-habitual-stock-2026-09-25.md). BUG CONOCIDO, anterior y separado (H9 en Producción, no arreglado): lee el saldo
 * de la base en cada llamada, así que dos ingredientes/líneas de la misma producción que consumen la misma familia no ven lo que tomó
 * el anterior y pueden pedir el mismo lote dos veces.
 */
export async function resolverConsumoPorFamilia(
  productoId: string,
  cantidadNecesaria: number,
  seccionId: string,
  db: Db,
  // Permite reusar un cache de producto por transacción (ver
  // producto-cache.ts) en vez de volver a pedir el mismo producto que el
  // llamador ya tiene — por defecto pide directo, para los llamadores que
  // no arman receta (o no les importa el round-trip extra).
  obtenerProducto: (id: string) => Promise<{ insumoId: string | null } | null> = (id) => db.producto.findUnique({ where: { id } })
): Promise<ParteDeReparto[]> {
  const sinReparto = async (): Promise<ParteDeReparto[]> => [
    { productoId, loteVencimiento: await obtenerLoteMasProximoAVencer(productoId, seccionId, db), cantidad: cantidadNecesaria },
  ];

  const producto = await obtenerProducto(productoId);
  if (!producto?.insumoId) return sinReparto();

  // Hermanos disponibles EN LA SUCURSAL de esta sección (docs/plan-disponibilidad-por-sucursal-2026-09-23.md §5.3) — antes
  // "activos" a secas podía repartir consumo a una MP que no se usa acá; ahora exige que de verdad esté habilitada en esta
  // sucursal, no solo en el catálogo central.
  const [candidatosHermanos, seccion] = await Promise.all([
    db.producto.findMany({ where: { insumoId: producto.insumoId, tipo: "MP" }, select: { id: true } }),
    db.seccion.findUniqueOrThrow({ where: { id: seccionId }, select: { sucursalId: true } }),
  ]);
  const disponibilidad = await disponibilidadDeProductos(seccion.sucursalId, candidatosHermanos.map((h) => h.id), db);
  const hermanoIds = candidatosHermanos.filter((h) => disponibilidad.get(h.id)).map((h) => h.id);
  if (!hermanoIds.length) return sinReparto();

  const lotes = await db.movimientoStock.groupBy({
    by: ["productoId", "loteVencimiento"],
    where: { productoId: { in: hermanoIds }, seccionId },
    _sum: { cantidad: true },
  });

  const partes = repartirConsumoPorFamilia(
    lotes.map((l) => ({ productoId: l.productoId, loteVencimiento: l.loteVencimiento, saldo: Number(l._sum.cantidad ?? 0) })),
    cantidadNecesaria
  );
  return partes ?? sinReparto(); // ni el Insumo entero alcanza: cae al camino de siempre
}
