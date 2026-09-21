import { prisma } from "@/lib/db";
import { redondearCantidad } from "./comun";
import type { Db } from "./comun";
import { resolverMinimosCuadrados } from "@/core/estadistica/minimos-cuadrados";

export interface FilaRendimientoSimple {
  productoVentaId: string;
  productoVentaNombre: string;
  recetaIngredienteId: string;
  /** El id de la MP anclada en la receta — para el link "usar este valor" al editor (?editar=). */
  insumoProductoId: string;
  insumoONombre: string;
  unidadRecetaNombre: string;
  cantidadActual: number;
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  totalComprado: number;
  totalVendido: number;
  semanasConDatos: number;
  confianza: "alta" | "media" | "baja" | "sin_datos";
  /**
   * Venta directa 1:1 sin transformación (1 unidad de receta, 0% merma) —
   * ej. una bebida envasada que se revende tal cual. Para estos casos el
   * desvío "real" no puede significar un error de receta (no hay nada que
   * calibrar: 1 vendido siempre debería consumir exactamente 1 comprado)
   * — lo que se ve es ruido de lote de compra (comprás por caja, vendés
   * de a uno) frente a la ventana de fechas elegida. Se marca en vez de
   * ocultarse: un desvío grande igual puede señalar rotura/robo no
   * cargado como Merma.
   */
  esTrivial: boolean;
}

export interface FilaRendimientoCompartido {
  poolClave: string;
  insumoONombre: string;
  productoVentaId: string;
  productoVentaNombre: string;
  recetaIngredienteId: string;
  insumoProductoId: string;
  unidadRecetaNombre: string;
  cantidadActual: number;
  /** El coeficiente resuelto por regresión para ESTE plato — null si el pool no fue resoluble. */
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  /** Cuántos platos comparten este pool — mismo valor repetido en todas las filas del pool. */
  cantidadPlatosEnPool: number;
  semanasConDatos: number;
  /** Calidad del ajuste (0-1) — mismo valor en todas las filas del pool, null si no se pudo resolver. */
  r2: number | null;
  resoluble: boolean;
  motivoNoResoluble: string | null;
  /** Ver el docstring del mismo campo en FilaRendimientoSimple — acá es por fila, no por pool: dos platos pueden compartir un insumo con cantidades/merma distintas. */
  esTrivial: boolean;
}

function rangoUtc(desdeIn: Date, hastaIn: Date): { desde: Date; hasta: Date } {
  const desde = new Date(desdeIn);
  desde.setUTCHours(0, 0, 0, 0);
  const hasta = new Date(hastaIn);
  hasta.setUTCHours(23, 59, 59, 999);
  return { desde, hasta };
}

const MS_POR_SEMANA = 7 * 24 * 60 * 60 * 1000;

function claveSemana(fecha: Date): number {
  return Math.floor(fecha.getTime() / MS_POR_SEMANA);
}

function contarSemanasConDatos(fechas: Date[]): number {
  return new Set(fechas.map(claveSemana)).size;
}

function calcularConfianza(semanas: number): FilaRendimientoSimple["confianza"] {
  if (semanas === 0) return "sin_datos";
  if (semanas >= 8) return "alta";
  if (semanas >= 4) return "media";
  return "baja";
}

interface UsoDeInsumo {
  pvProductoId: string;
  pvNombre: string;
  recetaIngredienteId: string;
  insumoProductoId: string;
  cantidad: number;
  unidadNombre: string;
  mermaPorcentaje: number;
}

/** Ver el docstring de `esTrivial` en FilaRendimientoSimple. */
function esUsoTrivial(uso: Pick<UsoDeInsumo, "cantidad" | "mermaPorcentaje">): boolean {
  return uso.cantidad === 1 && uso.mermaPorcentaje === 0;
}

interface Pool {
  clave: string;
  nombre: string;
  /** Todas las MP cuyas compras cuentan para este pool — los hermanos activos del Insumo, o el producto puntual solo. */
  productoIds: string[];
  usos: UsoDeInsumo[];
}

/**
 * Agrupa cada línea de receta vigente por "pool" — todos los hermanos
 * activos del mismo Insumo (mismo criterio de agrupación que
 * `resolverConsumoPorFamilia`), o el producto puntual solo si no tiene
 * Insumo asignado. Un pool con un único uso es el caso simple (Fase 1);
 * con 2+ usos es el caso compartido (Fase 2) — ambas fases comparten esta
 * construcción, solo cambia qué se hace con cada pool después.
 */
async function construirPools(db: Db): Promise<Pool[]> {
  const productosConReceta = await db.producto.findMany({
    where: { activo: true, recetaVersiones: { some: {} } },
    include: {
      recetaVersiones: {
        orderBy: { version: "desc" },
        take: 1,
        include: { ingredientes: { include: { insumoProducto: { include: { insumo: true } }, unidad: true } } },
      },
    },
  });

  const nombrePorClave = new Map<string, string>();
  const productoIdsPorClave = new Map<string, Set<string>>();
  const usosPorClave = new Map<string, UsoDeInsumo[]>();

  for (const pv of productosConReceta) {
    const vigente = pv.recetaVersiones[0];
    if (!vigente) continue;
    for (const ing of vigente.ingredientes) {
      const clave = ing.insumoProducto.insumoId ? `insumo:${ing.insumoProducto.insumoId}` : `producto:${ing.insumoProductoId}`;

      if (!productoIdsPorClave.has(clave)) productoIdsPorClave.set(clave, new Set());
      productoIdsPorClave.get(clave)!.add(ing.insumoProductoId);
      // Si agrupa por Insumo, el nombre del pool es el del Insumo mismo (no
      // el de la MP ancla) — de lo contrario, la última MP procesada bajo
      // la misma clave "ganaba" el nombre mostrado, por accidente.
      nombrePorClave.set(clave, ing.insumoProducto.insumo?.nombre ?? ing.insumoProducto.nombre);

      if (!usosPorClave.has(clave)) usosPorClave.set(clave, []);
      usosPorClave.get(clave)!.push({
        pvProductoId: pv.id,
        pvNombre: pv.nombre,
        recetaIngredienteId: ing.id,
        insumoProductoId: ing.insumoProductoId,
        cantidad: Number(ing.cantidad),
        unidadNombre: ing.unidad.nombre,
        mermaPorcentaje: Number(ing.mermaPorcentaje),
      });
    }
  }

  // Si el Insumo agrupa más de una MP, el pool de compras es TODOS los
  // hermanos activos (no solo el que quedó anclado en la receta) — mismo
  // criterio de "familia completa" que usa el consumo real de stock.
  for (const [clave, productoIds] of productoIdsPorClave) {
    if (!clave.startsWith("insumo:")) continue;
    const insumoId = clave.slice("insumo:".length);
    const hermanos = await db.producto.findMany({ where: { insumoId, tipo: "MP", activo: true }, select: { id: true } });
    for (const h of hermanos) productoIds.add(h.id);
  }

  return Array.from(usosPorClave.entries()).map(([clave, usos]) => ({
    clave,
    nombre: nombrePorClave.get(clave)!,
    productoIds: Array.from(productoIdsPorClave.get(clave)!),
    usos,
  }));
}

/**
 * Fase 1 del diseño (docs/diseno-rendimiento-recetas-por-sucursal.md §3.3):
 * solo el caso simple, un único PV consume de un pool — ahí el
 * "rendimiento real" es una división (compras / ventas), no hace falta
 * regresión.
 *
 * Corre SIEMPRE para UNA sola sucursal — nunca mezclado entre sucursales
 * (mismo motivo del diseño: mezclar promedia al cocinero que gasta poco
 * con el que gasta mucho y destruye la comparación que se busca).
 */
export async function calcularRendimientoRecetasSimples(
  sucursalId: string,
  desdeIn: Date,
  hastaIn: Date,
  db: Db = prisma
): Promise<FilaRendimientoSimple[]> {
  const { desde, hasta } = rangoUtc(desdeIn, hastaIn);
  const pools = await construirPools(db);
  const filas: FilaRendimientoSimple[] = [];

  for (const pool of pools) {
    if (pool.usos.length !== 1) continue; // Fase 2 — ver calcularRendimientoRecetasCompartidas.
    const uso = pool.usos[0];

    const [compras, ventas] = await Promise.all([
      db.movimientoStock.findMany({
        where: { seccion: { sucursalId }, operacion: { fecha: { gte: desde, lte: hasta }, anuladaEn: null }, proceso: "COMPRA", productoId: { in: pool.productoIds } },
        select: { cantidad: true, operacion: { select: { fecha: true } } },
      }),
      db.movimientoStock.findMany({
        where: { seccion: { sucursalId }, operacion: { fecha: { gte: desde, lte: hasta } }, proceso: "VENTA", productoId: uso.pvProductoId },
        select: { cantidad: true, operacion: { select: { fecha: true } } },
      }),
    ]);

    const totalComprado = redondearCantidad(compras.reduce((acc, m) => acc + Number(m.cantidad), 0));
    const totalVendido = redondearCantidad(ventas.reduce((acc, m) => acc + Math.abs(Number(m.cantidad)), 0));
    const semanasConDatos = contarSemanasConDatos([...compras, ...ventas].map((m) => m.operacion.fecha));

    const cantidadEstimada = totalVendido > 0 ? redondearCantidad(totalComprado / totalVendido) : null;
    const desviacionPorcentaje =
      cantidadEstimada !== null && uso.cantidad > 0 ? Math.round(((cantidadEstimada - uso.cantidad) / uso.cantidad) * 1000) / 10 : null;

    filas.push({
      productoVentaId: uso.pvProductoId,
      productoVentaNombre: uso.pvNombre,
      recetaIngredienteId: uso.recetaIngredienteId,
      insumoProductoId: uso.insumoProductoId,
      insumoONombre: pool.nombre,
      unidadRecetaNombre: uso.unidadNombre,
      cantidadActual: uso.cantidad,
      cantidadEstimada,
      desviacionPorcentaje,
      totalComprado,
      totalVendido,
      semanasConDatos,
      confianza: calcularConfianza(semanasConDatos),
      esTrivial: esUsoTrivial(uso),
    });
  }

  filas.sort(
    (a, b) => a.productoVentaNombre.localeCompare(b.productoVentaNombre, "es") || a.insumoONombre.localeCompare(b.insumoONombre, "es")
  );
  return filas;
}

/**
 * Fase 2 del diseño: el caso compartido, 2+ platos consumen del mismo
 * pool (ej. nalga/lomo/bife/cuadrada repartidos entre Milanesa y Bife).
 * Arma, por semana, compras del pool (y) y ventas de cada plato (X), y
 * resuelve mínimos cuadrados — un coeficiente estimado por plato.
 *
 * Si el sistema no es resoluble (pocas semanas, o la mezcla de ventas no
 * varió lo suficiente entre semanas) o el ajuste da algún coeficiente
 * negativo (consumo negativo no existe — señal de que el ajuste no es
 * confiable), NINGUNA fila del pool devuelve una cantidadEstimada: se
 * marca `resoluble: false` con el motivo, en vez de inventar un número.
 */
export async function calcularRendimientoRecetasCompartidas(
  sucursalId: string,
  desdeIn: Date,
  hastaIn: Date,
  db: Db = prisma
): Promise<FilaRendimientoCompartido[]> {
  const { desde, hasta } = rangoUtc(desdeIn, hastaIn);
  const pools = await construirPools(db);
  const filas: FilaRendimientoCompartido[] = [];

  for (const pool of pools) {
    if (pool.usos.length < 2) continue; // Fase 1 — ver calcularRendimientoRecetasSimples.

    const compras = await db.movimientoStock.findMany({
      where: { seccion: { sucursalId }, operacion: { fecha: { gte: desde, lte: hasta }, anuladaEn: null }, proceso: "COMPRA", productoId: { in: pool.productoIds } },
      select: { cantidad: true, operacion: { select: { fecha: true } } },
    });

    const ventasPorPlato = await Promise.all(
      pool.usos.map((uso) =>
        db.movimientoStock.findMany({
          where: { seccion: { sucursalId }, operacion: { fecha: { gte: desde, lte: hasta } }, proceso: "VENTA", productoId: uso.pvProductoId },
          select: { cantidad: true, operacion: { select: { fecha: true } } },
        })
      )
    );

    const comprasPorSemana = new Map<number, number>();
    for (const m of compras) comprasPorSemana.set(claveSemana(m.operacion.fecha), (comprasPorSemana.get(claveSemana(m.operacion.fecha)) ?? 0) + Number(m.cantidad));

    const ventasPorSemanaPorPlato = ventasPorPlato.map((ventas) => {
      const mapa = new Map<number, number>();
      for (const m of ventas) mapa.set(claveSemana(m.operacion.fecha), (mapa.get(claveSemana(m.operacion.fecha)) ?? 0) + Math.abs(Number(m.cantidad)));
      return mapa;
    });

    const todasLasSemanas = new Set<number>(comprasPorSemana.keys());
    for (const mapa of ventasPorSemanaPorPlato) for (const semana of mapa.keys()) todasLasSemanas.add(semana);
    const semanas = Array.from(todasLasSemanas).sort();

    const y = semanas.map((s) => comprasPorSemana.get(s) ?? 0);
    const X = semanas.map((s) => ventasPorSemanaPorPlato.map((mapa) => mapa.get(s) ?? 0));

    let motivoNoResoluble: string | null = null;
    if (semanas.length <= pool.usos.length) {
      motivoNoResoluble = `Hacen falta más semanas con datos (hay ${semanas.length}, se necesitan más de ${pool.usos.length} platos que comparten este insumo).`;
    }

    const resultado = motivoNoResoluble ? null : resolverMinimosCuadrados(X, y);
    if (!motivoNoResoluble && !resultado) {
      motivoNoResoluble = "La mezcla de ventas entre semanas no varió lo suficiente para separar cuánto consume cada plato de este pool.";
    }
    if (resultado && resultado.coeficientes.some((c) => c < 0)) {
      motivoNoResoluble = "El ajuste dio un consumo negativo para algún plato — no es confiable con los datos actuales.";
    }

    const resoluble = motivoNoResoluble === null;
    const r2 = resoluble ? resultado!.r2 : null;

    pool.usos.forEach((uso, i) => {
      const cantidadEstimada = resoluble ? redondearCantidad(resultado!.coeficientes[i]) : null;
      const desviacionPorcentaje =
        cantidadEstimada !== null && uso.cantidad > 0 ? Math.round(((cantidadEstimada - uso.cantidad) / uso.cantidad) * 1000) / 10 : null;

      filas.push({
        poolClave: pool.clave,
        insumoONombre: pool.nombre,
        productoVentaId: uso.pvProductoId,
        productoVentaNombre: uso.pvNombre,
        recetaIngredienteId: uso.recetaIngredienteId,
        insumoProductoId: uso.insumoProductoId,
        unidadRecetaNombre: uso.unidadNombre,
        cantidadActual: uso.cantidad,
        cantidadEstimada,
        desviacionPorcentaje,
        cantidadPlatosEnPool: pool.usos.length,
        semanasConDatos: semanas.length,
        r2,
        resoluble,
        motivoNoResoluble,
        esTrivial: esUsoTrivial(uso),
      });
    });
  }

  filas.sort((a, b) => a.insumoONombre.localeCompare(b.insumoONombre, "es") || a.productoVentaNombre.localeCompare(b.productoVentaNombre, "es"));
  return filas;
}
