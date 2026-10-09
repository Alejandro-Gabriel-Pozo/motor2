/**
 * El cálculo PURO del IPC (Pureza Fase 4, tramo C): sin base, sin red, sin reloj. Pedir la serie a la API, leer y guardar los meses y orquestar la sincronización viven en
 * `server/` (`server/adaptadores/cotizaciones/ipc.ts`, `server/lecturas/reportes/serie-ipc.ts`, `server/persistencia/reportes/indice-precio.ts` y el caso de uso
 * `server/actions/reportes/casos-de-uso/sincronizar-ipc.ts`).
 *
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
import { ZONA_ARGENTINA, diaDeCalendario, esDiaISOReal } from "@/core/tiempo/zona-horaria";

export interface SerieIPC {
  /** clave "YYYY-MM" -> valor del índice ese mes. */
  porMes: Map<string, number>;
  ultimoValor: number | null;
  /** Clave "YYYY-MM" del último mes publicado (el más reciente de la serie), o `null` si no hay ninguno. */
  ultimoMes: string | null;
}

/** La clave "YYYY-MM" (en UTC) del mes de una fecha. */
export function claveMes(fecha: Date): string {
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Arma la serie desde las filas YA LEÍDAS de la tabla, en el orden que llegan (el más reciente primero: `mes` descendente): el valor de cada mes y el último publicado
 * (la primera fila). Se llama UNA vez por reporte, nunca por línea (ver resolverCoeficienteIPC, que es puro/en memoria).
 */
export function armarSerieIPC(filas: readonly { mes: Date; valor: number }[]): SerieIPC {
  const porMes = new Map<string, number>();
  for (const f of filas) porMes.set(claveMes(f.mes), f.valor);
  return { porMes, ultimoValor: filas[0] ? filas[0].valor : null, ultimoMes: filas[0] ? claveMes(filas[0].mes) : null };
}

/**
 * `true` si el mes de `fecha` es POSTERIOR al último mes publicado: el INDEC publica con ~1 mes de rezago, así que el mes en curso
 * (y a veces el anterior) todavía no tiene índice.
 */
export function esMesSinPublicar(fecha: Date, serie: SerieIPC): boolean {
  return serie.ultimoMes !== null && claveMes(fecha) > serie.ultimoMes;
}

/**
 * Máximo de días de atraso de la serie del IPC antes de considerarla DESACTUALIZADA ("stale_days" de `get_exchange_rate` de ERPNext,
 * docs/grounding-pendientes-2026-09-18.md §5.3). Se mide desde el FIN del último mes publicado (el dato de un mes no puede existir antes de
 * que el mes termine, así que medir desde el inicio contaría como "atraso" el tiempo que el mes tardó en transcurrir).
 *
 * 60 porque el INDEC publica el IPC de un mes a mitad del mes siguiente: el rezago NORMAL llega a ~45 días medido así (el 12 de octubre el
 * último mes publicado sigue siendo agosto, ya 42 días después de su fin). 60 deja ~15 días de colchón: solo se cruza cuando se perdió AL
 * MENOS una publicación entera, no cuando el INDEC se demora unos días. Con 45 estaría justo en el borde de lo normal y alarmaría por
 * cualquier demora. Es una constante en código y no un dato en la base: es lo mismo que hace `DIAS_PARA_RELLENAR` con el dólar, y crear un
 * modelo de configuración solo para esto sería desproporcionado (ese trabajo es el de 5b, la fuente del índice como configuración).
 */
export const DIAS_MAXIMOS_DE_ATRASO_IPC = 60;

export type EstadoSerieIPC = "sin-datos" | "al-dia" | "vencida";

export interface AntiguedadSerieIPC {
  estado: EstadoSerieIPC;
  /** Clave "YYYY-MM" del último mes publicado, o `null` si no hay ninguno. */
  ultimoMes: string | null;
  /** Días desde el fin del último mes publicado; 0 si ese mes es el corriente o uno futuro. `null` sin datos. */
  diasDeAtraso: number | null;
  maximo: number;
}

/**
 * Cuán vieja es la serie: `sin-datos` (no hay ningún índice), `al-dia` (atraso dentro del máximo) o `vencida` (más de
 * `DIAS_MAXIMOS_DE_ATRASO_IPC` días desde el fin del último mes publicado). Pura: `ahora` se inyecta para poder probarla con fechas
 * exactas. Solo CLASIFICA — no cambia ningún número de ningún reporte: lo que cambia es lo que se le avisa al usuario sobre el número.
 *
 * Aritmética en UTC, igual que `claveMes` (que usa `getUTC*`): acá el umbral es de 60 días, 3 horas de diferencia no mueven nada.
 */
export function antiguedadSerieIPC(serie: SerieIPC, ahora: Date): AntiguedadSerieIPC {
  const maximo = DIAS_MAXIMOS_DE_ATRASO_IPC;
  if (serie.ultimoMes === null) return { estado: "sin-datos", ultimoMes: null, diasDeAtraso: null, maximo };
  const anio = Number(serie.ultimoMes.slice(0, 4));
  const mes = Number(serie.ultimoMes.slice(5, 7)); // 1-12: como índice de Date.UTC (0-11) ya es el mes SIGUIENTE, o sea el fin del último publicado
  const finDelUltimoMes = Date.UTC(anio, mes, 1);
  const diasDeAtraso = Math.max(0, Math.floor((ahora.getTime() - finDelUltimoMes) / 86_400_000));
  return { estado: diasDeAtraso > maximo ? "vencida" : "al-dia", ultimoMes: serie.ultimoMes, diasDeAtraso, maximo };
}

/**
 * Texto para cuando la serie está VENCIDA: dice desde cuándo y por qué el ajuste no es de "hoy". Distinto del rezago normal del INDEC
 * (que se rotula "provisorio"): acá el problema es nuestro (falta sincronizar), no del INDEC.
 */
export function textoSerieIPCVencida(a: AntiguedadSerieIPC): string {
  return `La serie del IPC no se actualiza desde ${a.ultimoMes} (${a.diasDeAtraso} días; el máximo previsto es ${a.maximo}): no es el rezago habitual del INDEC, falta sincronizar.`;
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

/** Tope de un valor del índice aceptado de la API (S-30): base dic-2016 = 100, hoy ronda las decenas de miles; la columna es `Decimal(12,4)` (hasta 99.999.999,9999). */
const VALOR_MAXIMO_DEL_IPC = 10_000_000;

export interface ResultadoSincronizacionIPC {
  mesesNuevos: number;
  ultimoMesDisponible: string | null;
  /**
   * Cuán vieja quedó la serie GUARDADA después de sincronizar (se relee de la base): `ultimoMesDisponible` sale de la API y no dice nada
   * de lo guardado. Un cron que responde 200 con `mesesNuevos: 0` todos los días durante meses es indistinguible de uno sano sin esto.
   */
  antiguedad: AntiguedadSerieIPC;
}

/**
 * Lee la respuesta de la API de series de tiempo (datos.gob.ar): los meses con un valor válido, en el orden en que vienen. Lanza si la respuesta no trae una serie. Una fila con
 * forma rara de un tercero (fecha que no es texto o no se entiende, valor que no es un número finito y positivo) se saltea, no se guarda (informe de seguridad S-19); no hay
 * tope de variación: la inflación mensual llegó a 25,5% (dic-2023).
 */
export function leerSerieDeLaApi(json: unknown, ahora: Date): { mes: Date; valor: number }[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("API de series de tiempo (datos.gob.ar): respuesta sin serie");
  const hoyISO = diaDeCalendario(ahora, ZONA_ARGENTINA);
  const filas: { mes: Date; valor: number }[] = [];
  for (const fila of data) {
    const [fechaStr, valor]: unknown[] = Array.isArray(fila) ? fila : [];
    // S-30: la fecha es un primer-de-mes real y no es del futuro (la API publica con ~1 mes de rezago), y el valor entra en la columna `Decimal(12,4)` con margen: lo que
    // escribe un tercero lo leen todas las empresas.
    if (!esDiaISOReal(fechaStr) || !fechaStr.endsWith("-01") || fechaStr > hoyISO) continue;
    if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0 || valor > VALOR_MAXIMO_DEL_IPC) continue;
    filas.push({ mes: new Date(fechaStr), valor }); // "YYYY-MM-01" — Date() lo interpreta como medianoche UTC, mismo criterio que el resto del proyecto.
  }
  return filas;
}
