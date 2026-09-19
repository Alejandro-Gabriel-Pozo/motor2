import { prisma } from "@/lib/db";
import type { Db } from "./comun";

/**
 * Método 1 de ajuste de margen (docs/comparativa-ux-erpnext-dolibarr.md
 * §9/§10) — ver el docstring de IndicePrecio en schema.prisma. A
 * diferencia de MovimientoStock.costoUnitarioVenta (Método 3, solo hacia
 * adelante), esto SÍ es retroactivo: el INDEC publica el índice de
 * cualquier mes pasado, así que sirve para ajustar ventas ya cargadas.
 *
 * Serie elegida: IPC GBA Nivel General, base dic-2016
 * (101.1_I2NG_2016_M_22) — republicada sin API key por la API de series
 * de tiempo del Ministerio de Economía, verificada real (no documentación
 * genérica) el 2026-09-17: `curl
 * "https://apis.datos.gob.ar/series/api/series/?ids=101.1_I2NG_2016_M_22&format=json"`
 * devuelve datos reales, mes más reciente publicado con el rezago habitual
 * de ~1 mes del INDEC.
 */
const SERIE_IPC_GBA_NIVEL_GENERAL = "101.1_I2NG_2016_M_22";
// `limit` explícito a propósito: sin él, la API devuelve como máximo 100
// filas en orden ASCENDENTE (las más viejas primero) — verificado real el
// 2026-09-17, truncaba la serie completa (125 meses) justo antes de
// llegar a los meses recientes. 5000 cubre >400 años de datos mensuales,
// nunca va a ser el límite real.
const URL_API_SERIES = `https://apis.datos.gob.ar/series/api/series/?ids=${SERIE_IPC_GBA_NIVEL_GENERAL}&format=json&limit=5000`;

export interface SerieIPC {
  /** clave "YYYY-MM" -> valor del índice ese mes. */
  porMes: Map<string, number>;
  ultimoValor: number | null;
  /** Clave "YYYY-MM" del último mes publicado (el más reciente de la serie), o `null` si no hay ninguno. */
  ultimoMes: string | null;
}

function claveMes(fecha: Date): string {
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Una sola consulta — se llama UNA vez por reporte, nunca por línea (ver resolverCoeficienteIPC, que es puro/en memoria). */
export async function cargarSerieIPC(db: Db = prisma): Promise<SerieIPC> {
  const filas = await db.indicePrecio.findMany({ orderBy: { mes: "desc" } });
  const porMes = new Map<string, number>();
  for (const f of filas) porMes.set(claveMes(f.mes), Number(f.valor));
  return { porMes, ultimoValor: filas[0] ? Number(filas[0].valor) : null, ultimoMes: filas[0] ? claveMes(filas[0].mes) : null };
}

/**
 * `true` si el mes de `fecha` es POSTERIOR al último mes publicado: el INDEC publica con ~1 mes de rezago, así que el mes en curso
 * (y a veces el anterior) todavía no tiene índice.
 */
export function esMesSinPublicar(fecha: Date, serie: SerieIPC): boolean {
  return serie.ultimoMes !== null && claveMes(fecha) > serie.ultimoMes;
}

/**
 * Coeficiente para llevar una venta de `fecha` a poder adquisitivo del
 * ÚLTIMO mes con IPC cargado (no necesariamente "hoy" — el INDEC publica
 * con rezago, ver docstring del módulo).
 *
 * Un mes POSTERIOR al último publicado (el mes en curso, todavía sin índice) no deja la venta afuera: se la trata como
 * hecha en el último mes publicado (coeficiente 1, sin inflación entre medio). Es PROVISORIO: subestima el ajuste en lo que
 * subió el índice desde entonces, y como el reporte se recalcula en cada lectura, se corrige solo cuando el INDEC publica el
 * mes (ver `esMesSinPublicar` para avisarlo en pantalla). `null` solo si no hay ningún índice cargado o el mes es anterior al
 * último y falta en la serie (un hueco real: no se inventa un valor intermedio).
 */
export function resolverCoeficienteIPC(fecha: Date, serie: SerieIPC): number | null {
  if (serie.ultimoValor === null) return null;
  if (esMesSinPublicar(fecha, serie)) return 1;
  const valorMes = serie.porMes.get(claveMes(fecha));
  if (valorMes === undefined || valorMes <= 0) return null;
  return serie.ultimoValor / valorMes;
}

/**
 * Variación % del índice entre el mes de `desde` y el de `hasta` — a
 * diferencia de `resolverCoeficienteIPC` (que lleva una fecha al ÚLTIMO mes
 * cargado, pensado para ajustar una venta a poder adquisitivo de hoy), esto
 * compara dos puntos cualquiera de la serie: "cuánto subió la inflación
 * general en este mismo rango que estoy mirando" (paso 5 del grounding,
 * docs/grounding-reportes-compras-2026-09-18.md §5, comparativa de precios
 * del período contra IPC). `null` si falta el dato de cualquiera de los dos
 * meses.
 *
 * Sigue usando `SERIE_IPC_GBA_NIVEL_GENERAL` (arriba) — el roadmap del
 * grounding sugiere una serie de "IPC Alimentos y bebidas" en vez de Nivel
 * General para este comparador puntual, pero cambiar la serie sin verificar
 * antes un id real (mismo criterio que ya exige este archivo, ver
 * docstring de la constante) no es seguro: el acceso a
 * apis.datos.gob.ar/datos.gob.ar está bloqueado por la política de egreso
 * de la sesión en la que se implementó este paso. La función queda
 * parametrizada por `SerieIPC` a propósito — el día que se verifique un id
 * real de Alimentos y bebidas, cambiar la constante y resincronizar alcanza,
 * sin tocar esta función.
 */
export function resolverVariacionPeriodoIPC(desde: Date, hasta: Date, serie: SerieIPC): number | null {
  // Si el mes de INICIO todavía no se publicó, el período entero está en meses sin índice: no hay nada que medir. Tomar los dos
  // extremos como «el último publicado» daría 0 %, que no es «sin inflación» sino «sin dato» (el mes en curso es el que sale por defecto).
  if (esMesSinPublicar(desde, serie)) return null;
  // Un mes FINAL posterior al último publicado se toma como el último publicado (provisorio: mide hasta ahí, ver `resolverCoeficienteIPC`).
  const enSerie = (fecha: Date) => (esMesSinPublicar(fecha, serie) ? serie.ultimoMes! : claveMes(fecha));
  const valorDesde = serie.porMes.get(enSerie(desde));
  const valorHasta = serie.porMes.get(enSerie(hasta));
  if (valorDesde === undefined || valorHasta === undefined || valorDesde <= 0) return null;
  return Math.round((valorHasta / valorDesde - 1) * 1000) / 10;
}

export interface ResultadoSincronizacionIPC {
  mesesNuevos: number;
  ultimoMesDisponible: string | null;
}

/**
 * Trae la serie completa de la API (es chica, ~10 años de datos mensuales
 * — no hace falta paginar ni pedir solo lo nuevo) e inserta los meses que
 * todavía no están. NUNCA reescribe un mes ya guardado — el IPC de un mes
 * cerrado no cambia, y si alguna vez el INDEC revisa un dato, que sea una
 * decisión explícita, no un sobrescribe silencioso de este job.
 */
export async function sincronizarIPC(db: Db = prisma): Promise<ResultadoSincronizacionIPC> {
  const resp = await fetch(URL_API_SERIES, { cache: "no-store" });
  if (!resp.ok) throw new Error(`API de series de tiempo (datos.gob.ar) respondió ${resp.status}`);
  const json = (await resp.json()) as { data: [string, number][] };

  const existentes = await db.indicePrecio.findMany({ select: { mes: true } });
  const mesesExistentes = new Set(existentes.map((f) => claveMes(f.mes)));

  let mesesNuevos = 0;
  let ultimoMesDisponible: string | null = null;
  for (const [fechaStr, valor] of json.data) {
    const mes = new Date(fechaStr); // "YYYY-MM-01" — Date() lo interpreta como medianoche UTC, mismo criterio que el resto del proyecto.
    const clave = claveMes(mes);
    if (!ultimoMesDisponible || clave > ultimoMesDisponible) ultimoMesDisponible = clave;
    if (mesesExistentes.has(clave)) continue;
    await db.indicePrecio.create({ data: { mes, valor } });
    mesesNuevos++;
  }
  return { mesesNuevos, ultimoMesDisponible };
}
