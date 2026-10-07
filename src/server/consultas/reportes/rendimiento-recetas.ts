import { cargarClasificacionNoComestibles, obtenerCostoActualPorMP } from "@/server/lecturas/reportes/comun";
import { redondearCantidad, bandaDeRuidoDeLote, calcularCantidadEstimadaNeta, calcularCantidadTeoricaBruta, calcularDesviacionPorcentaje, compararPorImpacto, impactoDelDesvio, motivoSinEstimacion as calcularMotivoSinEstimacion, motivoSinEstimacionConteo as calcularMotivoSinEstimacionConteo, rotularLineaDeReceta, anclasValidasEnVentana, clavePar, consumoRealDelTramo, elegirAnclas, finDelDiaUtc, limitesDelTramo, type CostoMP, type Anclas, type CandidatoAncla, type MetodoRendimiento, type MovimientoParaConciliar } from "@/core/reportes/public";
import { ZONA_UTC, inicioDelDiaDe, rangoDeDias } from "@/core/tiempo/zona-horaria";
import type { Db } from "@/lib/db-tipos";
import { rendimientoEfectivo } from "@/core/catalogo/public";
import { whereDisponibleEn, alcanceDeSucursal } from "@/core/catalogo/public";
import { cargarRecetasVigentes } from "@/server/lecturas/catalogo/recetas-vigentes";
import { resolverMinimosCuadrados } from "@/core/estadistica/minimos-cuadrados";
import { OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION } from "@/core/movimientos/public";
import type { FilaRendimientoSimple, FilaRendimientoCompartido, UsoDeInsumo, Pool, ResultadoPoolCompartido } from "@/core/reportes/public";

/**
 * Saldo del pool antes de `desde` y después de `hasta` — CONTEXTO, nunca
 * entra en ninguna fórmula de rendimiento (docs/plan-rendimiento-recetas-
 * 2026-09-22.md §B4). Sin filtro de `proceso` (es TODO el movimiento real
 * del pool, no solo compras/producción) y SIN `anuladaEn: null` — la
 * anulación es su propio contra-asiento (compra + reversión AJUSTE); si se
 * filtrara, el saldo quedaría mal. Mismo patrón que `historial-producto.ts`
 * (`saldoInicial`, con `operacion.fecha < desde`, sin filtro de anuladas).
 *
 * NUNCA "restar Δstock" del estimado para corregir el sesgo de compra por
 * lote: es tautológico. El saldo del sistema ya asume la propia receta
 * (cada venta escribe un CONSUMO = receta × vendido), así que
 * `stockCierre - stockApertura` siempre da el mismo desvío que ya se está
 * calculando — nunca 0 % "real" ni ningún otro número independiente. La
 * única forma de medir un consumo real independiente del Kardex es un
 * Conteo Físico (`metodo: "CONTEO"`, ver rendimiento-conciliado.ts) — con
 * dos anclas RESUELTO que cubren el pool entero, se suma el consumo real
 * DIRECTO por proceso entre ellas, en vez de inferirlo de las compras.
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

/** El día calendario (UTC, D3) de `fecha` — medianoche, para agrupar Conteo Físico por día sin importar la hora exacta a la que se registró. */
function diaUtc(fecha: Date): Date {
  return inicioDelDiaDe(fecha, ZONA_UTC);
}

/**
 * Los días candidatos a ancla del pool dentro de `[desde, hasta]` (Task
 * #26, Diseño B — D1/D3): busca los `ConteoFisico` `RESUELTO` de
 * cualquier producto del pool en la ventana, los agrupa por día calendario
 * y, para cada día con al menos un conteo, calcula el saldo de TODO el
 * pool (todos los productos, todas las secciones de la sucursal) al
 * cierre de ese día — el insumo que le falta a `esAnclaValida`/
 * `elegirAnclas`/`anclasValidasEnVentana` (rendimiento-conciliado.ts) para
 * decidir cuáles de estos días cubrieron al pool entero. `[]` sin ningún
 * conteo en la ventana.
 */
async function construirCandidatosAncla(sucursalId: string, productoIds: string[], desde: Date, hasta: Date, db: Db): Promise<CandidatoAncla[]> {
  const conteos = await db.conteoFisico.findMany({
    where: { sucursalId, productoId: { in: productoIds }, estado: "RESUELTO", fecha: { gte: desde, lte: hasta } },
    select: { productoId: true, seccionId: true, fecha: true },
  });
  if (conteos.length === 0) return [];

  const diaPorClave = new Map<string, Date>();
  const paresContadosPorDia = new Map<string, Set<string>>();
  for (const c of conteos) {
    const dia = diaUtc(c.fecha);
    const clave = dia.toISOString();
    diaPorClave.set(clave, dia);
    if (!paresContadosPorDia.has(clave)) paresContadosPorDia.set(clave, new Set());
    paresContadosPorDia.get(clave)!.add(clavePar(c.productoId, c.seccionId));
  }

  return Promise.all(
    Array.from(diaPorClave.entries()).map(async ([clave, dia]) => {
      const saldos = await db.movimientoStock.groupBy({
        by: ["productoId", "seccionId"],
        where: { seccion: { sucursalId }, productoId: { in: productoIds }, operacion: { fecha: { lte: finDelDiaUtc(dia) } } },
        _sum: { cantidad: true },
      });
      const paresConSaldo = new Set(saldos.filter((s) => Number(s._sum.cantidad ?? 0) !== 0).map((s) => clavePar(s.productoId, s.seccionId)));
      return { fecha: dia, paresContados: paresContadosPorDia.get(clave)!, paresConSaldo };
    })
  );
}

/**
 * Las dos anclas del pool (caso simple, Fase 1) — `null` sin dos días que
 * califiquen dentro de `[desde, hasta]`, el llamador cae al método
 * COMPRAS (D4).
 */
async function elegirAnclasDelPool(sucursalId: string, productoIds: string[], desde: Date, hasta: Date, db: Db): Promise<Anclas | null> {
  const candidatos = await construirCandidatosAncla(sucursalId, productoIds, desde, hasta, db);
  return elegirAnclas(candidatos, desde, hasta);
}

/**
 * Los movimientos de un tramo (entre dos anclas) que cuentan como consumo
 * real de la receta (D2), listos para `consumoRealDelTramo`. `anuladaEn:
 * null` cubre la VENTA/PRODUCCION detrás de un CONSUMO que se haya anulado
 * después — un consumo de una venta que ya no existe no puede contar como
 * consumo real. `OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION` excluye el
 * AJUSTE que escribe anular una COMPRA/VENTA (D2 — es el propio deshacer
 * del sistema, no un ajuste manual), sin importar si cae dentro o fuera
 * del tramo (escenario F del plan: una compra que se anula DESPUÉS de
 * `hasta` ya queda afuera por fecha, pero el filtro es el mismo sin
 * excepción).
 */
async function movimientosDelTramoParaConciliar(sucursalId: string, productoIds: string[], anclas: Anclas, db: Db): Promise<MovimientoParaConciliar[]> {
  const { desde, hasta } = limitesDelTramo(anclas);
  const movimientos = await db.movimientoStock.findMany({
    where: {
      seccion: { sucursalId },
      productoId: { in: productoIds },
      proceso: { in: ["CONSUMO", "CONTROL", "AJUSTE"] },
      operacion: { anuladaEn: null, fecha: { gt: desde, lte: hasta }, ...OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION },
    },
    select: { cantidad: true, proceso: true, operacion: { select: { proceso: true } } },
  });
  return movimientos.map((m) => ({ procesoMovimiento: m.proceso, procesoOperacion: m.operacion.proceso, cantidad: Number(m.cantidad) }));
}

/** Vendido de un producto puntual DENTRO de un tramo (entre dos anclas) — mismo filtro de anuladas que el resto de este archivo para VENTA. */
async function vendidoDelTramo(sucursalId: string, productoId: string, anclas: Anclas, db: Db): Promise<number> {
  const { desde, hasta } = limitesDelTramo(anclas);
  const ventas = await db.movimientoStock.findMany({
    where: { seccion: { sucursalId }, productoId, proceso: "VENTA", operacion: { fecha: { gt: desde, lte: hasta }, anuladaEn: null } },
    select: { cantidad: true },
  });
  return redondearCantidad(ventas.reduce((acc, m) => acc + Math.abs(Number(m.cantidad)), 0));
}

/**
 * El costo de reposición del pool — entre `productoIds` que tengan costo
 * conocido (`obtenerCostoActualPorMP`, la MISMA fuente de costo que usa el
 * resto del proyecto), el de la compra MÁS RECIENTE; empate en fecha →
 * el de menor `productoId` (determinismo, sin depender del orden de
 * iteración del Map). `null` si ninguno de los hermanos del pool tiene
 * costo conocido — nunca se inventa un precio.
 */
function costoUnitarioDePool(productoIds: string[], costos: Map<string, CostoMP>): number | null {
  let mejor: { id: string; precio: number; fecha: Date | null } | null = null;
  for (const id of productoIds) {
    const c = costos.get(id);
    if (!c) continue;
    const fechaActual = c.fecha?.getTime() ?? -Infinity;
    const fechaMejor = mejor?.fecha?.getTime() ?? -Infinity;
    if (!mejor || fechaActual > fechaMejor || (fechaActual === fechaMejor && id < mejor.id)) {
      mejor = { id, precio: c.precioPorUnidadStock, fecha: c.fecha };
    }
  }
  return mejor?.precio ?? null;
}

function rangoUtc(desdeIn: Date, hastaIn: Date): { desde: Date; hasta: Date } {
  return rangoDeDias(desdeIn, hastaIn, ZONA_UTC);
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

/**
 * Agrupa cada línea de receta vigente por "pool" — todos los hermanos
 * activos del mismo Insumo (mismo criterio de agrupación que
 * `resolverConsumoPorFamilia`), o el producto puntual solo si no tiene
 * Insumo asignado. Un pool con un único uso es el caso simple (Fase 1);
 * con 2+ usos es el caso compartido (Fase 2) — ambas fases comparten esta
 * construcción, solo cambia qué se hace con cada pool después.
 */
async function construirPools(sucursalId: string, db: Db): Promise<Pool[]> {
  const alcance = alcanceDeSucursal(sucursalId);
  const [productosDisponibles, clasificacion] = await Promise.all([db.producto.findMany({ where: whereDisponibleEn(sucursalId) }), cargarClasificacionNoComestibles(db)]);
  // La receta EFECTIVA de la sucursal: la propia donde la tiene habilitada, la central (más calibraciones) en los demás platos.
  const recetaVigente = await cargarRecetasVigentes(db, alcance, {
    where: { productoId: { in: productosDisponibles.map((p) => p.id) } },
    include: {
      ingredientes: {
        include: { insumoProducto: { include: { insumo: true } }, unidad: true, rendimientosLocales: { where: { sucursalId } } },
      },
    },
  });

  const nombrePorClave = new Map<string, string>();
  const productoIdsPorClave = new Map<string, Set<string>>();
  const usosPorClave = new Map<string, UsoDeInsumo[]>();

  for (const pv of productosDisponibles) {
    const vigente = recetaVigente.get(pv.id);
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
      const cantidadCentral = Number(ing.cantidad);
      const mermaPorcentajeCentral = Number(ing.mermaPorcentaje);
      const ef = rendimientoEfectivo(
        { cantidad: cantidadCentral, mermaPorcentaje: mermaPorcentajeCentral },
        ing.rendimientosLocales.map((r) => ({ sucursalId: r.sucursalId, cantidad: r.cantidad !== null ? Number(r.cantidad) : null, mermaPorcentaje: r.mermaPorcentaje !== null ? Number(r.mermaPorcentaje) : null })),
        sucursalId
      );
      usosPorClave.get(clave)!.push({
        pvProductoId: pv.id,
        pvNombre: pv.nombre,
        recetaIngredienteId: ing.id,
        insumoProductoId: ing.insumoProductoId,
        cantidad: ef.cantidad,
        unidadNombre: ing.unidad.nombre,
        mermaPorcentaje: ef.mermaPorcentaje,
        cantidadCentral,
        mermaPorcentajeCentral,
        calibradoLocal: ef.calibrado,
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
    const hermanos = await db.producto.findMany({ where: { insumoId, tipo: "MP", ...whereDisponibleEn(sucursalId) }, select: { id: true } });
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
  db: Db
): Promise<FilaRendimientoSimple[]> {
  const { desde, hasta } = rangoUtc(desdeIn, hastaIn);
  const [pools, costos] = await Promise.all([construirPools(sucursalId, db), obtenerCostoActualPorMP(sucursalId, db)]);
  const filas: FilaRendimientoSimple[] = [];

  for (const pool of pools) {
    if (pool.usos.length !== 1) continue; // Fase 2 — ver calcularRendimientoRecetasCompartidas.
    const uso = pool.usos[0];

    const costoUnitario = costoUnitarioDePool(pool.productoIds, costos);
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

    // Task #26 (Diseño B): con dos anclas de Conteo Físico que cubren el pool entero, el consumo se MIDE directo
    // por proceso entre ellas (metodo="CONTEO") — sin ellas (D4), se cae al método de siempre (metodo="COMPRAS",
    // totalEntradas/totalVendido). Nunca se deja la fila sin ningún número.
    const anclas = await elegirAnclasDelPool(sucursalId, pool.productoIds, desde, hasta, db);
    let metodo: MetodoRendimiento;
    let cantidadEstimadaBruta: number | null;
    let impactoPesos: number | null;
    let bandaRuidoPct: number | null;
    let motivoSinEstimacionFila: string | null;
    let anclaDesde: Date | null = null;
    let anclaHasta: Date | null = null;
    let consumoReal: number | null = null;

    if (anclas) {
      metodo = "CONTEO";
      anclaDesde = anclas.anclaDesde;
      anclaHasta = anclas.anclaHasta;
      const [movimientosParaConciliar, vendidoTramo] = await Promise.all([
        movimientosDelTramoParaConciliar(sucursalId, pool.productoIds, anclas, db),
        vendidoDelTramo(sucursalId, uso.pvProductoId, anclas, db),
      ]);
      consumoReal = consumoRealDelTramo(movimientosParaConciliar);
      cantidadEstimadaBruta = vendidoTramo > 0 ? redondearCantidad(consumoReal / vendidoTramo) : null;
      impactoPesos = impactoDelDesvio(consumoReal, cantidadTeoricaBruta, vendidoTramo, costoUnitario);
      // La banda de ruido de lote es contexto para cuando el estimado viene de compras (D4 del plan) — con un
      // Conteo Físico real de por medio ya no hace falta: el número no es un estimado de "cuánto se compró de a
      // lotes", es una medición directa.
      bandaRuidoPct = null;
      motivoSinEstimacionFila = calcularMotivoSinEstimacionConteo({ vendidoDelTramo: vendidoTramo, cantidadTeoricaBruta });
    } else {
      metodo = "COMPRAS";
      // 0 entradas con ventas sí registradas daría -100% (0/vendido) — un número inventado a partir de "no entró nada", no una medición (defecto 1 de §3). Se prefiere null + el motivo explicado, igual que sin ventas.
      cantidadEstimadaBruta = totalVendido > 0 && totalEntradas > 0 ? redondearCantidad(totalEntradas / totalVendido) : null;
      impactoPesos = impactoDelDesvio(totalEntradas, cantidadTeoricaBruta, totalVendido, costoUnitario);
      // `entradas` ya viene filtrada por anuladaEn: null (misma consulta que totalComprado) — este filtro es solo para separar COMPRA de PRODUCCION, no vuelve a decidir nada sobre anuladas.
      const cantidadesDeCadaCompra = entradas.filter((m) => m.proceso === "COMPRA").map((m) => Number(m.cantidad));
      bandaRuidoPct = bandaDeRuidoDeLote(cantidadesDeCadaCompra, totalVendido, cantidadTeoricaBruta);
      motivoSinEstimacionFila = calcularMotivoSinEstimacion({ totalVendido, totalEntradas, cantidadTeoricaBruta });
    }

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
      cantidadActualCentral: uso.cantidadCentral,
      calibradoLocal: uso.calibradoLocal,
      mermaActual: uso.mermaPorcentaje,
      cantidadEstimada,
      desviacionPorcentaje,
      totalComprado,
      totalProducido,
      totalEntradas,
      totalVendido,
      stockApertura,
      stockCierre,
      metodo,
      anclaDesde,
      anclaHasta,
      consumoReal,
      bandaRuidoPct,
      impactoPesos,
      sinCosto: costoUnitario === null,
      motivoSinEstimacion: motivoSinEstimacionFila,
      semanasConDatos,
      confianza: calcularConfianza(semanasConDatos),
      rotulo: rotularLineaDeReceta({ insumoSeProduce: uso.insumoSeProduce, insumoEsNoComestible: uso.insumoEsNoComestible, pvSeProduce: uso.pvSeProduce, cantidadReceta: uso.cantidadCentral, mermaPorcentaje: uso.mermaPorcentajeCentral }),
    });
  }

  // Por impacto en $ — decisión 5 de §3, ordena por plata, no por %. Desempate: el orden alfabético de siempre.
  filas.sort((a, b) =>
    compararPorImpacto(a, b, (f) => f.impactoPesos, (x, y) => x.productoVentaNombre.localeCompare(y.productoVentaNombre, "es") || x.insumoONombre.localeCompare(y.insumoONombre, "es"))
  );
  return filas;
}

/**
 * Intenta el método CONTEO (Task #26 §6): cada intervalo ENTRE DOS ANCLAS
 * consecutivas (`anclasValidasEnVentana`) es una observación — `y_k` es el
 * consumo real del intervalo (misma fórmula que la Fase 1, sumado para el
 * pool ENTERO), `X_k` son las ventas de CADA plato en ese mismo intervalo.
 * `null` si no hay al menos `pool.usos.length + 1` anclas válidas dentro de
 * `[desde, hasta]` — ni siquiera llega a intentar la regresión (mismo
 * umbral que el método COMPRAS, en intervalos en vez de en semanas).
 */
async function resolverPoolPorConteo(sucursalId: string, pool: Pool, desde: Date, hasta: Date, db: Db): Promise<ResultadoPoolCompartido | null> {
  const candidatos = await construirCandidatosAncla(sucursalId, pool.productoIds, desde, hasta, db);
  const anclas = anclasValidasEnVentana(candidatos, desde, hasta);
  if (anclas.length <= pool.usos.length) return null; // hacen falta más intervalos que platos — ni la primera y la última ancla, tomadas solas, alcanzarían (mismo motivo que la Fase 1).

  const intervalos: Anclas[] = [];
  for (let i = 0; i < anclas.length - 1; i++) intervalos.push({ anclaDesde: anclas[i], anclaHasta: anclas[i + 1] });

  const y: number[] = [];
  const X: number[][] = [];
  for (const intervalo of intervalos) {
    const [movimientos, ventasPorUso] = await Promise.all([
      movimientosDelTramoParaConciliar(sucursalId, pool.productoIds, intervalo, db),
      Promise.all(pool.usos.map((uso) => vendidoDelTramo(sucursalId, uso.pvProductoId, intervalo, db))),
    ]);
    y.push(consumoRealDelTramo(movimientos));
    X.push(ventasPorUso);
  }

  const resultado = resolverMinimosCuadrados(X, y);
  if (!resultado || resultado.coeficientes.some((c) => c < 0)) return null; // singular o consumo negativo — cae a COMPRAS, no se inventa un número.

  return { metodo: "CONTEO", resoluble: true, motivoNoResoluble: null, r2: resultado.r2, coeficientes: resultado.coeficientes, observaciones: intervalos.length };
}

/**
 * Fase 2 del diseño: el caso compartido, 2+ platos consumen del mismo
 * pool (ej. nalga/lomo/bife/cuadrada repartidos entre Milanesa y Bife).
 *
 * Primero intenta el método CONTEO (Task #26 §6, `resolverPoolPorConteo`)
 * — con suficientes anclas de Conteo Físico que cubren el pool entero, el
 * consumo real de cada intervalo se MIDE directo, en vez de asumirse de
 * las compras. Sin eso (pocos intervalos, sistema singular o algún
 * coeficiente negativo — D4), cae al método COMPRAS de siempre: arma, por
 * semana, compras del pool (y) y ventas de cada plato (X), y resuelve
 * mínimos cuadrados igual.
 *
 * Si NINGUNO de los dos es resoluble (pocas semanas/intervalos, o la
 * mezcla de ventas no varió lo suficiente) o el ajuste da algún
 * coeficiente negativo (consumo negativo no existe — señal de que el
 * ajuste no es confiable), NINGUNA fila del pool devuelve una
 * cantidadEstimada: se marca `resoluble: false` con el motivo, en vez de
 * inventar un número.
 */
export async function calcularRendimientoRecetasCompartidas(
  sucursalId: string,
  desdeIn: Date,
  hastaIn: Date,
  db: Db
): Promise<FilaRendimientoCompartido[]> {
  const { desde, hasta } = rangoUtc(desdeIn, hastaIn);
  const [pools, costos] = await Promise.all([construirPools(sucursalId, db), obtenerCostoActualPorMP(sucursalId, db)]);
  const filas: FilaRendimientoCompartido[] = [];

  for (const pool of pools) {
    if (pool.usos.length < 2) continue; // Fase 1 — ver calcularRendimientoRecetasSimples.

    const costoUnitario = costoUnitarioDePool(pool.productoIds, costos);
    const { stockApertura, stockCierre } = await calcularStockAperturaYCierre(sucursalId, pool.productoIds, desde, hasta, db);

    // Contexto SIEMPRE de la ventana elegida (desde/hasta), sin importar qué método termine resolviendo el pool —
    // mismo criterio que Fase 1: el "Comprado"/"Vendido" que se muestra es siempre el de la ventana del reporte.
    // COMPRA + PRODUCCION: mismo motivo que Fase 1 — un insumo con seProduce=true entra por producción, no por compra. anuladaEn: null cubre la COMPRA que el guardián de anuladas exige.
    const entradas = await db.movimientoStock.findMany({
      where: { seccion: { sucursalId }, operacion: { fecha: { gte: desde, lte: hasta }, anuladaEn: null }, proceso: { in: ["COMPRA", "PRODUCCION"] }, productoId: { in: pool.productoIds } },
      select: { cantidad: true, proceso: true, operacion: { select: { fecha: true } } },
    });
    const cantidadesDeCadaCompraPool = entradas.filter((m) => m.proceso === "COMPRA").map((m) => Number(m.cantidad));

    const ventasPorPlato = await Promise.all(
      pool.usos.map((uso) =>
        db.movimientoStock.findMany({
          where: { seccion: { sucursalId }, operacion: { fecha: { gte: desde, lte: hasta }, anuladaEn: null }, proceso: "VENTA", productoId: uso.pvProductoId },
          select: { cantidad: true, operacion: { select: { fecha: true } } },
        })
      )
    );
    const totalEntradasPool = redondearCantidad(entradas.reduce((acc, m) => acc + Number(m.cantidad), 0));

    const porConteo = await resolverPoolPorConteo(sucursalId, pool, desde, hasta, db);

    const resultadoPool: ResultadoPoolCompartido =
      porConteo ??
      (() => {
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
        return { metodo: "COMPRAS" as MetodoRendimiento, resoluble, motivoNoResoluble, r2: resoluble ? resultado!.r2 : null, coeficientes: resoluble ? resultado!.coeficientes : null, observaciones: semanas.length };
      })();

    const { metodo, resoluble, motivoNoResoluble, r2, coeficientes, observaciones } = resultadoPool;

    pool.usos.forEach((uso, i) => {
      // El coeficiente de la regresión sale en la misma unidad que `y` (consumo real o entradas crudas del pool, según el método) — es BRUTO, misma interpretación que cantidadEstimadaBruta de Fase 1.
      const cantidadEstimadaBruta = resoluble ? redondearCantidad(coeficientes![i]) : null;
      const cantidadTeoricaBruta = calcularCantidadTeoricaBruta(uso.cantidad, uso.mermaPorcentaje);
      const cantidadEstimada = cantidadEstimadaBruta !== null ? calcularCantidadEstimadaNeta(cantidadEstimadaBruta, uso.mermaPorcentaje) : null;
      const desviacionPorcentaje = calcularDesviacionPorcentaje(cantidadEstimadaBruta, cantidadTeoricaBruta);
      const totalVendidoUso = redondearCantidad(ventasPorPlato[i].reduce((acc, m) => acc + Math.abs(Number(m.cantidad)), 0));
      // La banda de ruido de lote es contexto de compras por lote (D4) — con Conteo Físico real de por medio (CONTEO) ya no aplica, mismo criterio que Fase 1.
      const bandaRuidoPct = metodo === "CONTEO" ? null : bandaDeRuidoDeLote(cantidadesDeCadaCompraPool, totalVendidoUso, cantidadTeoricaBruta);
      // Si la regresión ya explicó por qué no hay estimado (motivoNoResoluble), no hace falta un segundo motivo más básico encima.
      const motivo = motivoNoResoluble
        ? null
        : metodo === "CONTEO"
          ? calcularMotivoSinEstimacionConteo({ vendidoDelTramo: totalVendidoUso, cantidadTeoricaBruta })
          : calcularMotivoSinEstimacion({ totalVendido: totalVendidoUso, totalEntradas: totalEntradasPool, cantidadTeoricaBruta });
      // Impacto de ESTE plato (no del pool entero): reconstruye "cuánto consumió ESTE plato" a partir del coeficiente ya estimado (cantidadEstimadaBruta × lo que vendió), y de ahí la misma resta que Fase 1. Sin regresión resoluble, no hay estimado del que partir → null (nunca se inventa un impacto).
      const impactoPesos = cantidadEstimadaBruta !== null ? impactoDelDesvio(redondearCantidad(cantidadEstimadaBruta * totalVendidoUso), cantidadTeoricaBruta, totalVendidoUso, costoUnitario) : null;

      filas.push({
        poolClave: pool.clave,
        insumoONombre: pool.nombre,
        productoVentaId: uso.pvProductoId,
        productoVentaNombre: uso.pvNombre,
        recetaIngredienteId: uso.recetaIngredienteId,
        insumoProductoId: uso.insumoProductoId,
        unidadRecetaNombre: uso.unidadNombre,
        cantidadActual: uso.cantidad,
        cantidadActualCentral: uso.cantidadCentral,
        calibradoLocal: uso.calibradoLocal,
        mermaActual: uso.mermaPorcentaje,
        cantidadEstimada,
        desviacionPorcentaje,
        totalVendido: totalVendidoUso,
        impactoPesos,
        sinCosto: costoUnitario === null,
        motivoSinEstimacion: motivo,
        cantidadPlatosEnPool: pool.usos.length,
        totalEntradasPool,
        stockApertura,
        stockCierre,
        bandaRuidoPct,
        semanasConDatos: observaciones,
        r2,
        metodo,
        resoluble,
        motivoNoResoluble,
        rotulo: rotularLineaDeReceta({ insumoSeProduce: uso.insumoSeProduce, insumoEsNoComestible: uso.insumoEsNoComestible, pvSeProduce: uso.pvSeProduce, cantidadReceta: uso.cantidadCentral, mermaPorcentaje: uso.mermaPorcentajeCentral }),
      });
    });
  }

  // Por impacto en $ — decisión 5 de §3. Dos niveles: los POOLS se ordenan por su mayor |impactoPesos| (page.tsx arma los grupos en el orden en que aparecen acá), y DENTRO de cada pool, sus filas por el propio |impactoPesos|.
  const maxImpactoPorPool = new Map<string, number | null>();
  for (const f of filas) {
    const actual = maxImpactoPorPool.get(f.poolClave);
    if (f.impactoPesos !== null && (actual === undefined || actual === null || Math.abs(f.impactoPesos) > Math.abs(actual))) maxImpactoPorPool.set(f.poolClave, f.impactoPesos);
    else if (!maxImpactoPorPool.has(f.poolClave)) maxImpactoPorPool.set(f.poolClave, null);
  }
  filas.sort((a, b) => {
    if (a.poolClave !== b.poolClave) {
      return compararPorImpacto(
        { impactoPesos: maxImpactoPorPool.get(a.poolClave) ?? null },
        { impactoPesos: maxImpactoPorPool.get(b.poolClave) ?? null },
        (f) => f.impactoPesos,
        () => a.insumoONombre.localeCompare(b.insumoONombre, "es")
      );
    }
    return compararPorImpacto(a, b, (f) => f.impactoPesos, (x, y) => x.productoVentaNombre.localeCompare(y.productoVentaNombre, "es"));
  });
  return filas;
}