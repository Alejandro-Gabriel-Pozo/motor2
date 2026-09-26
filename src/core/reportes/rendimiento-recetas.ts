import { prisma } from "@/lib/db";
import { cargarClasificacionNoComestibles, obtenerCostoActualPorMP, redondearCantidad } from "./comun";
import type { CostoMP, Db } from "./comun";
import { whereDisponibleEn } from "@/core/catalogo/disponibilidad-producto-consulta";
import { rendimientoEfectivo } from "@/core/catalogo/rendimiento-local";
import { resolverMinimosCuadrados } from "@/core/estadistica/minimos-cuadrados";
import { OPERACION_QUE_NO_ES_REVERSION_POR_ANULACION } from "@/core/movimientos/anulaciones";
import {
  bandaDeRuidoDeLote,
  calcularCantidadEstimadaNeta,
  calcularCantidadTeoricaBruta,
  calcularDesviacionPorcentaje,
  compararPorImpacto,
  impactoDelDesvio,
  motivoSinEstimacion as calcularMotivoSinEstimacion,
  motivoSinEstimacionConteo as calcularMotivoSinEstimacionConteo,
  rotularLineaDeReceta,
  type RotuloLinea,
} from "./rendimiento-recetas-vistas";
import {
  clavePar,
  consumoRealDelTramo,
  elegirAnclas,
  finDelDiaUtc,
  limitesDelTramo,
  type Anclas,
  type CandidatoAncla,
  type MetodoRendimiento,
  type MovimientoParaConciliar,
} from "./rendimiento-conciliado";

export interface FilaRendimientoSimple {
  productoVentaId: string;
  productoVentaNombre: string;
  recetaIngredienteId: string;
  /** El id de la MP anclada en la receta — para el link "usar este valor" al editor (?editar=). */
  insumoProductoId: string;
  insumoONombre: string;
  unidadRecetaNombre: string;
  /** EFECTIVO de la sucursal (rendimientoEfectivo, D2) — el central, salvo que esta sucursal lo haya calibrado. */
  cantidadActual: number;
  /** El valor del Catálogo Central, SIN calibrar — para "(calibrado acá; central: X)" en la UI. */
  cantidadActualCentral: number;
  /** true si ESTA sucursal calibró cantidad y/o merma de esta línea. */
  calibradoLocal: boolean;
  /** Merma % EFECTIVA de esta sucursal — la que se CONGELA junto con `cantidadEstimada` al calibrar (D4, decisión del dueño). */
  mermaActual: number;
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
  /**
   * Saldo del pool DESPUÉS de `hasta` (`stockApertura + deltaStock`) — si
   * subió durante la ventana, parte de lo "comprado" en realidad se quedó
   * en el depósito, no se consumió. El caso real del Agua (+14,3 % con
   * Δstock=+9) es 0 % de desvío real SOLO SI un Conteo Físico confirma que
   * esos +9 están de verdad en el depósito (`metodo: "CONTEO"` — ver
   * rendimiento-conciliado.ts); sin ese conteo (`metodo: "COMPRAS"`) el
   * Δstock queda como advertencia de sesgo, no como una corrección: el
   * "restar Δstock" es tautológico (el propio saldo del sistema ya asume
   * la receta, vía el CONSUMO que cada venta escribe), así que no hay
   * ninguna forma de saber si esos +9 son acopio real o faltante sin medir
   * el depósito con un conteo físico real.
   */
  stockCierre: number;
  /**
   * "CONTEO" = medido (Task #26, Diseño B): hay dos `ConteoFisico`
   * `RESUELTO` que cubren el pool entero, uno al principio y otro al
   * final del tramo — `cantidadEstimada`/`desviacionPorcentaje` salen de
   * sumar el consumo real DIRECTO por proceso entre esas dos anclas
   * (`anclaDesde`/`anclaHasta`/`consumoReal`), nunca de las compras.
   * "COMPRAS" = estimado, el método de siempre (`totalEntradas /
   * totalVendido`) — D4: SIN las dos anclas, nunca se deja la fila sin
   * ningún número, se cae a este método, marcado como menos confiable.
   */
  metodo: MetodoRendimiento;
  /** Solo `metodo === "CONTEO"` — el día (calendario, D3) del Conteo Físico que abre el tramo medido. `null` en método COMPRAS. */
  anclaDesde: Date | null;
  /** Solo `metodo === "CONTEO"` — el día del Conteo Físico que cierra el tramo medido. `null` en método COMPRAS. */
  anclaHasta: Date | null;
  /** Solo `metodo === "CONTEO"` — −Σ CONSUMO(venta/producción) − Σ CONTROL − Σ AJUSTE(no-reversión) entre las dos anclas (ver `consumoRealDelTramo`). `null` en método COMPRAS. */
  consumoReal: number | null;
  /** Por qué `cantidadEstimada` es null, cuando lo es — nunca se oculta la fila, se explica (docs/plan-rendimiento-recetas-2026-09-22.md §B7). */
  motivoSinEstimacion: string | null;
  /** Cuánto puede moverse el % de desvío solo por comprar de a lotes — CONTEXTO en texto, nunca decide si la celda se pinta ámbar (eso es fijo, ver `desvioEsNotable`). Ver `bandaDeRuidoDeLote`. */
  bandaRuidoPct: number | null;
  /** (entradas reales − lo que la receta hubiera consumido) × costo de reposición — lo que ORDENA el ranking, no el %. Ver `impactoDelDesvio`. */
  impactoPesos: number | null;
  /** true cuando `impactoPesos` es null por falta de costo conocido (nunca se inventa un precio — mismo criterio que perdidas.ts). */
  sinCosto: boolean;
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
  /** EFECTIVO de la sucursal (rendimientoEfectivo, D2) — el central, salvo que esta sucursal lo haya calibrado. */
  cantidadActual: number;
  /** El valor del Catálogo Central, SIN calibrar — para "(calibrado acá; central: X)" en la UI. */
  cantidadActualCentral: number;
  /** true si ESTA sucursal calibró cantidad y/o merma de esta línea. */
  calibradoLocal: boolean;
  /** Merma % EFECTIVA de esta sucursal — la que se CONGELA junto con `cantidadEstimada` al calibrar (D4, decisión del dueño). */
  mermaActual: number;
  /** El coeficiente resuelto por regresión para ESTE plato, ya en NETO — null si el pool no fue resoluble. */
  cantidadEstimada: number | null;
  desviacionPorcentaje: number | null;
  /** Vendido de ESTE plato (no del pool) — antes se calculaba para la regresión y se descartaba, sin exponerse en la fila. */
  totalVendido: number;
  /** Ver docstring en FilaRendimientoSimple — acá con el `totalVendido` de ESTE plato, no del pool. */
  impactoPesos: number | null;
  sinCosto: boolean;
  /** Cuántos platos comparten este pool — mismo valor repetido en todas las filas del pool. */
  cantidadPlatosEnPool: number;
  /** Comprado + producido del POOL entero en la ventana — mismo valor repetido en todas las filas del pool (a diferencia de Fase 1, acá no hay "totalComprado" por plato: el pool es lo que se ajusta). */
  totalEntradasPool: number;
  /** Ver docstring en FilaRendimientoSimple — acá es del POOL, mismo valor repetido en todas sus filas. */
  stockApertura: number;
  stockCierre: number;
  /** Ver docstring en FilaRendimientoSimple — el LOTE de compra es del pool (todo el insumo compartido), pero la banda en sí es por FILA: depende de cuánto vendió y qué recta pide CADA plato, así que varía entre las filas de un mismo pool. */
  bandaRuidoPct: number | null;
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
  const d = new Date(fecha);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Las dos anclas de Conteo Físico del pool dentro de `[desde, hasta]`
 * (Task #26, Diseño B — D1/D3/D4): busca los `ConteoFisico` `RESUELTO` de
 * cualquier producto del pool en la ventana, los agrupa por día calendario
 * y, para cada día con al menos un conteo, calcula el saldo de TODO el
 * pool (todos los productos, todas las secciones de la sucursal) al
 * cierre de ese día — para decidir si ESE día cubrió al pool entero
 * (`elegirAnclas`, rendimiento-conciliado.ts). `null` sin ningún conteo en
 * la ventana, o sin dos días que califiquen — el llamador cae al método
 * COMPRAS (D4).
 */
async function elegirAnclasDelPool(sucursalId: string, productoIds: string[], desde: Date, hasta: Date, db: Db): Promise<Anclas | null> {
  const conteos = await db.conteoFisico.findMany({
    where: { sucursalId, productoId: { in: productoIds }, estado: "RESUELTO", fecha: { gte: desde, lte: hasta } },
    select: { productoId: true, seccionId: true, fecha: true },
  });
  if (conteos.length === 0) return null;

  const diaPorClave = new Map<string, Date>();
  const paresContadosPorDia = new Map<string, Set<string>>();
  for (const c of conteos) {
    const dia = diaUtc(c.fecha);
    const clave = dia.toISOString();
    diaPorClave.set(clave, dia);
    if (!paresContadosPorDia.has(clave)) paresContadosPorDia.set(clave, new Set());
    paresContadosPorDia.get(clave)!.add(clavePar(c.productoId, c.seccionId));
  }

  const candidatos: CandidatoAncla[] = await Promise.all(
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
  /** EFECTIVO (rendimientoEfectivo, D2) — el central, salvo que esta sucursal lo haya calibrado. */
  cantidad: number;
  unidadNombre: string;
  /** EFECTIVO — ver `cantidad`. */
  mermaPorcentaje: number;
  /** Los valores del Catálogo Central, SIN calibrar — para "(calibrado acá; central: X)" en la UI. */
  cantidadCentral: number;
  mermaPorcentajeCentral: number;
  calibradoLocal: boolean;
  /** Los tres datos DECLARADOS que alimentan `rotularLineaDeReceta` — ver su docstring en rendimiento-recetas-vistas.ts.
   * SIEMPRE con los valores CENTRALES (cantidadCentral/mermaPorcentajeCentral): el rótulo clasifica la ESTRUCTURA
   * declarada de la receta, no si esta sucursal la calibró — una calibración local no puede cambiar de qué "tipo" de
   * línea se trata. */
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
async function construirPools(sucursalId: string, db: Db): Promise<Pool[]> {
  const [productosConReceta, clasificacion] = await Promise.all([
    db.producto.findMany({
      where: { ...whereDisponibleEn(sucursalId), recetaVersiones: { some: {} } },
      include: {
        recetaVersiones: {
          orderBy: { version: "desc" },
          take: 1,
          include: {
            ingredientes: {
              include: { insumoProducto: { include: { insumo: true } }, unidad: true, rendimientosLocales: { where: { sucursalId } } },
            },
          },
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
  db: Db = prisma
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
  const [pools, costos] = await Promise.all([construirPools(sucursalId, db), obtenerCostoActualPorMP(sucursalId, db)]);
  const filas: FilaRendimientoCompartido[] = [];

  for (const pool of pools) {
    if (pool.usos.length < 2) continue; // Fase 1 — ver calcularRendimientoRecetasSimples.

    const costoUnitario = costoUnitarioDePool(pool.productoIds, costos);
    const { stockApertura, stockCierre } = await calcularStockAperturaYCierre(sucursalId, pool.productoIds, desde, hasta, db);

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
      const bandaRuidoPct = bandaDeRuidoDeLote(cantidadesDeCadaCompraPool, totalVendidoUso, cantidadTeoricaBruta);
      // Si la regresión ya explicó por qué no hay estimado (motivoNoResoluble), no hace falta un segundo motivo más básico encima.
      const motivo = motivoNoResoluble ? null : calcularMotivoSinEstimacion({ totalVendido: totalVendidoUso, totalEntradas: totalEntradasPool, cantidadTeoricaBruta });
      // Impacto de ESTE plato (no del pool entero): reconstruye "cuánto de las entradas del pool le toca a este plato" a partir del coeficiente ya estimado (cantidadEstimadaBruta × lo que vendió), y de ahí la misma resta que Fase 1. Sin regresión resoluble, no hay estimado del que partir → null (nunca se inventa un impacto).
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
        semanasConDatos: semanas.length,
        r2,
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
