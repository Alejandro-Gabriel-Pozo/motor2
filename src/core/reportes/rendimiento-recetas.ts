import { prisma } from "@/lib/db";
import { cargarClasificacionNoComestibles, redondearCantidad } from "./comun";
import type { Db } from "./comun";
import { resolverMinimosCuadrados } from "@/core/estadistica/minimos-cuadrados";
import {
  calcularCantidadEstimadaNeta,
  calcularCantidadTeoricaBruta,
  calcularDesviacionPorcentaje,
  motivoSinEstimacion as calcularMotivoSinEstimacion,
  rotularLineaDeReceta,
  type RotuloLinea,
} from "./rendimiento-recetas-vistas";

export interface FilaRendimientoSimple {
  productoVentaId: string;
  productoVentaNombre: string;
  recetaIngredienteId: string;
  /** El id de la MP anclada en la receta — para el link "usar este valor" al editor (?editar=). */
  insumoProductoId: string;
  insumoONombre: string;
  unidadRecetaNombre: string;
  cantidadActual: number;
  /** NETO (misma base que `cantidadActual` — RecetaIngrediente.cantidad es neta) — ver docstring de `calcularCantidadEstimadaNeta`, es lo que se escribe si se usa este valor. */
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  totalComprado: number;
  /** Solo insumos con `seProduce: true` pueden tener esto > 0 — un insumo producido nunca antes contaba como entrada, y por eso siempre daba -100% (defecto 1 de §3). */
  totalProducido: number;
  /** totalComprado + totalProducido — lo que de verdad entró al pool en la ventana. */
  totalEntradas: number;
  totalVendido: number;
  /** Saldo del pool ANTES de `desde` — contexto, nunca entra en ninguna fórmula (ver docstring de `stockCierre`). */
  stockApertura: number;
  /** Saldo del pool DESPUÉS de `hasta` (`stockApertura + deltaStock`) — si subió durante la ventana, parte de lo "comprado" en realidad se quedó en el depósito, no se consumió (el caso real del Agua: +14,3 % con Δstock=+9 es 0 % de desvío real). */
  stockCierre: number;
  /** Por qué `cantidadEstimada` es null, cuando lo es — nunca se oculta la fila, se explica (docs/plan-rendimiento-recetas-2026-09-22.md §B7). */
  motivoSinEstimacion: string | null;
  semanasConDatos: number;
  confianza: "alta" | "media" | "baja" | "sin_datos";
  /**
   * Rótulo DECLARADO (nunca inferido) — reemplaza el viejo `esTrivial`
   * (`cantidad===1 && merma===0`, que rotulaba mal una sub-receta producida
   * o un packaging como "venta directa"). Ver `rotularLineaDeReceta`
   * (rendimiento-recetas-vistas.ts) para la prioridad exacta entre los tres
   * casos. Ninguno oculta la fila.
   */
  rotulo: RotuloLinea;
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
  /** El coeficiente resuelto por regresión para ESTE plato, ya en NETO — null si el pool no fue resoluble. */
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  /** Cuántos platos comparten este pool — mismo valor repetido en todas las filas del pool. */
  cantidadPlatosEnPool: number;
  /** Comprado + producido del POOL entero en la ventana — mismo valor repetido en todas las filas del pool (a diferencia de Fase 1, acá no hay "totalComprado" por plato: el pool es lo que se ajusta). */
  totalEntradasPool: number;
  /** Ver docstring en FilaRendimientoSimple — acá es del POOL, mismo valor repetido en todas sus filas. */
  stockApertura: number;
  stockCierre: number;
  semanasConDatos: number;
  /** Calidad del ajuste (0-1) — mismo valor en todas las filas del pool, null si no se pudo resolver. */
  r2: number | null;
  resoluble: boolean;
  motivoNoResoluble: string | null;
  /** Solo cuando SÍ es resoluble pero el desvío no se puede calcular igual (ver docstring en FilaRendimientoSimple) — si `motivoNoResoluble` ya explica la falta de estimado, este queda null (es más básico). */
  motivoSinEstimacion: string | null;
  /** Ver el docstring del mismo campo en FilaRendimientoSimple — acá es por fila, no por pool: dos platos pueden compartir un insumo con cantidades/merma distintas, así que el rótulo también puede ser distinto por fila. */
  rotulo: RotuloLinea;
}

/**
 * Saldo del pool antes de `desde` y después de `hasta` — CONTEXTO, nunca
 * entra en ninguna fórmula de rendimiento (docs/plan-rendimiento-recetas-
 * 2026-09-22.md §B4). Sin filtro de `proceso` (es TODO el movimiento real
 * del pool, no solo compras/producción) y SIN `anuladaEn: null` — la
 * anulación es su propio contra-asiento (compra + reversión AJUSTE); si se
 * filtrara, el saldo quedaría mal. Mismo patrón que `historial-producto.ts`
 * (`saldoInicial`, con `operacion.fecha < desde`, sin filtro de anuladas).
 */
async function calcularStockAperturaYCierre(sucursalId: string, productoIds: string[], desde: Date, hasta: Date, db: Db): Promise<{ stockApertura: number; stockCierre: number }> {
  const [apertura, delta] = await Promise.all([
    db.movimientoStock.aggregate({ where: { seccion: { sucursalId }, productoId: { in: productoIds }, operacion: { fecha: { lt: desde } } }, _sum: { cantidad: true } }),
    db.movimientoStock.aggregate({ where: { seccion: { sucursalId }, productoId: { in: productoIds }, operacion: { fecha: { gte: desde, lte: hasta } } }, _sum: { cantidad: true } }),
  ]);
  const stockApertura = redondearCantidad(Number(apertura._sum.cantidad ?? 0));
  const stockCierre = redondearCantidad(stockApertura + Number(delta._sum.cantidad ?? 0));
  return { stockApertura, stockCierre };
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
  /** Los tres datos DECLARADOS que alimentan `rotularLineaDeReceta` — ver su docstring en rendimiento-recetas-vistas.ts. */
  insumoSeProduce: boolean;
  insumoEsNoComestible: boolean;
  pvSeProduce: boolean;
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
  const [productosConReceta, clasificacion] = await Promise.all([
    db.producto.findMany({
      where: { activo: true, recetaVersiones: { some: {} } },
      include: {
        recetaVersiones: {
          orderBy: { version: "desc" },
          take: 1,
          include: { ingredientes: { include: { insumoProducto: { include: { insumo: true } }, unidad: true } } },
        },
      },
    }),
    cargarClasificacionNoComestibles(db),
  ]);

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
        insumoSeProduce: ing.insumoProducto.seProduce,
        insumoEsNoComestible: ing.insumoProducto.insumo?.grupoId ? clasificacion.idsGrupos.has(ing.insumoProducto.insumo.grupoId) : false,
        pvSeProduce: pv.seProduce,
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

    const { stockApertura, stockCierre } = await calcularStockAperturaYCierre(sucursalId, pool.productoIds, desde, hasta, db);

    const [entradas, ventas] = await Promise.all([
      // COMPRA + PRODUCCION: un insumo con seProduce=true (una sub-receta) entra por producción, no por compra — antes solo se miraba COMPRA, así que un insumo así siempre daba -100% (defecto 1 de §3). anuladaEn: null cubre la COMPRA que el guardián de anuladas exige.
      db.movimientoStock.findMany({
        where: { seccion: { sucursalId }, operacion: { fecha: { gte: desde, lte: hasta }, anuladaEn: null }, proceso: { in: ["COMPRA", "PRODUCCION"] }, productoId: { in: pool.productoIds } },
        select: { cantidad: true, proceso: true, operacion: { select: { fecha: true } } },
      }),
      db.movimientoStock.findMany({
        where: { seccion: { sucursalId }, operacion: { fecha: { gte: desde, lte: hasta }, anuladaEn: null }, proceso: "VENTA", productoId: uso.pvProductoId },
        select: { cantidad: true, operacion: { select: { fecha: true } } },
      }),
    ]);

    // `entradas` ya salió filtrada por anuladaEn: null arriba — separar COMPRA de PRODUCCION acá es solo para mostrarlas por separado, no vuelve a decidir nada sobre anuladas.
    const totalComprado = redondearCantidad(entradas.filter((m) => m.proceso === "COMPRA").reduce((acc, m) => acc + Number(m.cantidad), 0));
    const totalProducido = redondearCantidad(entradas.filter((m) => m.proceso === "PRODUCCION").reduce((acc, m) => acc + Number(m.cantidad), 0));
    const totalEntradas = redondearCantidad(totalComprado + totalProducido);
    const totalVendido = redondearCantidad(ventas.reduce((acc, m) => acc + Math.abs(Number(m.cantidad)), 0));
    const semanasConDatos = contarSemanasConDatos([...entradas, ...ventas].map((m) => m.operacion.fecha));

    const cantidadTeoricaBruta = calcularCantidadTeoricaBruta(uso.cantidad, uso.mermaPorcentaje);
    // 0 entradas con ventas sí registradas daría -100% (0/vendido) — un número inventado a partir de "no entró nada", no una medición (defecto 1 de §3). Se prefiere null + el motivo explicado, igual que sin ventas.
    const cantidadEstimadaBruta = totalVendido > 0 && totalEntradas > 0 ? redondearCantidad(totalEntradas / totalVendido) : null;
    const cantidadEstimada = cantidadEstimadaBruta !== null ? calcularCantidadEstimadaNeta(cantidadEstimadaBruta, uso.mermaPorcentaje) : null;
    const desviacionPorcentaje = calcularDesviacionPorcentaje(cantidadEstimadaBruta, cantidadTeoricaBruta);

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
      totalProducido,
      totalEntradas,
      totalVendido,
      stockApertura,
      stockCierre,
      motivoSinEstimacion: calcularMotivoSinEstimacion({ totalVendido, totalEntradas, cantidadTeoricaBruta }),
      semanasConDatos,
      confianza: calcularConfianza(semanasConDatos),
      rotulo: rotularLineaDeReceta({ insumoSeProduce: uso.insumoSeProduce, insumoEsNoComestible: uso.insumoEsNoComestible, pvSeProduce: uso.pvSeProduce, cantidadReceta: uso.cantidad, mermaPorcentaje: uso.mermaPorcentaje }),
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

    const { stockApertura, stockCierre } = await calcularStockAperturaYCierre(sucursalId, pool.productoIds, desde, hasta, db);

    // COMPRA + PRODUCCION: mismo motivo que Fase 1 — un insumo con seProduce=true entra por producción, no por compra. anuladaEn: null cubre la COMPRA que el guardián de anuladas exige.
    const entradas = await db.movimientoStock.findMany({
      where: { seccion: { sucursalId }, operacion: { fecha: { gte: desde, lte: hasta }, anuladaEn: null }, proceso: { in: ["COMPRA", "PRODUCCION"] }, productoId: { in: pool.productoIds } },
      select: { cantidad: true, operacion: { select: { fecha: true } } },
    });

    const ventasPorPlato = await Promise.all(
      pool.usos.map((uso) =>
        db.movimientoStock.findMany({
          where: { seccion: { sucursalId }, operacion: { fecha: { gte: desde, lte: hasta }, anuladaEn: null }, proceso: "VENTA", productoId: uso.pvProductoId },
          select: { cantidad: true, operacion: { select: { fecha: true } } },
        })
      )
    );

    const entradasPorSemana = new Map<number, number>();
    for (const m of entradas) entradasPorSemana.set(claveSemana(m.operacion.fecha), (entradasPorSemana.get(claveSemana(m.operacion.fecha)) ?? 0) + Number(m.cantidad));

    const ventasPorSemanaPorPlato = ventasPorPlato.map((ventas) => {
      const mapa = new Map<number, number>();
      for (const m of ventas) mapa.set(claveSemana(m.operacion.fecha), (mapa.get(claveSemana(m.operacion.fecha)) ?? 0) + Math.abs(Number(m.cantidad)));
      return mapa;
    });

    const todasLasSemanas = new Set<number>(entradasPorSemana.keys());
    for (const mapa of ventasPorSemanaPorPlato) for (const semana of mapa.keys()) todasLasSemanas.add(semana);
    const semanas = Array.from(todasLasSemanas).sort();

    const y = semanas.map((s) => entradasPorSemana.get(s) ?? 0);
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
    const totalEntradasPool = redondearCantidad(entradas.reduce((acc, m) => acc + Number(m.cantidad), 0));

    pool.usos.forEach((uso, i) => {
      // El coeficiente de la regresión sale en la misma unidad que `y` (entradas crudas del pool) — es BRUTO, misma interpretación que cantidadEstimadaBruta de Fase 1.
      const cantidadEstimadaBruta = resoluble ? redondearCantidad(resultado!.coeficientes[i]) : null;
      const cantidadTeoricaBruta = calcularCantidadTeoricaBruta(uso.cantidad, uso.mermaPorcentaje);
      const cantidadEstimada = cantidadEstimadaBruta !== null ? calcularCantidadEstimadaNeta(cantidadEstimadaBruta, uso.mermaPorcentaje) : null;
      const desviacionPorcentaje = calcularDesviacionPorcentaje(cantidadEstimadaBruta, cantidadTeoricaBruta);
      const totalVendidoUso = redondearCantidad(ventasPorPlato[i].reduce((acc, m) => acc + Math.abs(Number(m.cantidad)), 0));
      // Si la regresión ya explicó por qué no hay estimado (motivoNoResoluble), no hace falta un segundo motivo más básico encima.
      const motivo = motivoNoResoluble ? null : calcularMotivoSinEstimacion({ totalVendido: totalVendidoUso, totalEntradas: totalEntradasPool, cantidadTeoricaBruta });

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
        motivoSinEstimacion: motivo,
        cantidadPlatosEnPool: pool.usos.length,
        totalEntradasPool,
        stockApertura,
        stockCierre,
        semanasConDatos: semanas.length,
        r2,
        resoluble,
        motivoNoResoluble,
        rotulo: rotularLineaDeReceta({ insumoSeProduce: uso.insumoSeProduce, insumoEsNoComestible: uso.insumoEsNoComestible, pvSeProduce: uso.pvSeProduce, cantidadReceta: uso.cantidad, mermaPorcentaje: uso.mermaPorcentaje }),
      });
    });
  }

  filas.sort((a, b) => a.insumoONombre.localeCompare(b.insumoONombre, "es") || a.productoVentaNombre.localeCompare(b.productoVentaNombre, "es"));
  return filas;
}
