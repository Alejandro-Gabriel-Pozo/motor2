import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";

/**
 * Dólar oficial del Banco Nación, para ver precios y valores también en dólares (Resumen, Período, Valuación y el encabezado): el cálculo PURO. Sin base, sin red, sin
 * reloj ni entorno: la hora (`ahora`) entra por parámetro. Pedirlo a las APIs de terceros, leer y guardar las cotizaciones y orquestar la sincronización viven en `server/`
 * (Pureza Fase 4, tramo C): `server/adaptadores/cotizaciones/dolar.ts`, `server/persistencia/reportes/cotizacion-dolar.ts` y el caso de uso
 * `server/actions/reportes/casos-de-uso/sincronizar-dolar.ts`.
 *
 * Fuentes, verificadas con `curl` el 2026-09-19:
 * - Hoy: `dolarapi.com/v1/dolares/oficial` (compra 1485 / venta 1535, con la hora de actualización).
 * - Historial diario: `api.argentinadatos.com/v1/cotizaciones/dolares/oficial` (los mismos valores que la anterior en los días en
 *   común). Solo se usa para rellenar los días que faltan (tabla vacía o cron caído varios días), no en cada corrida.
 * - Respaldo: la API del BCRA (`api.bcra.gob.ar/estadisticascambiarias`), que trae UN valor (la cotización de referencia): va en `venta`.
 * Ninguna es una API oficial del Banco Nación (el BNA no publica una): si las dos de arriba caen, el dólar queda con el último día
 * guardado y `obtenerUltimaCotizacion` dice de qué fecha es.
 *
 * NOTA: la serie `168.1_T_CAMBIOR_D_0_0_26` que figuraba en docs/comparativa-ux-erpnext-dolibarr.md §10 NO es el tipo de cambio
 * oficial: es el dólar futuro (Rofex). No usarla.
 */
/** Desde cuándo se rellena el historial cuando la tabla está vacía. */
const HISTORIAL_DESDE = "2026-01-01";
/** Si el último día guardado tiene más de tantos días de antigüedad, se rellena el historial faltante. */
const DIAS_PARA_RELLENAR = 3;

export interface CotizacionDia {
  fecha: string; // YYYY-MM-DD
  compra: number | null;
  venta: number;
  fuente: "BNA" | "BCRA";
}

export interface UltimaCotizacion {
  fecha: Date;
  compra: number | null;
  venta: number;
  fuente: string;
}

/** Fecha (YYYY-MM-DD) en la zona de Argentina (el mercado cambiario) de un instante. */
export function fechaArgentina(instante: Date): string {
  return diaDeCalendario(instante, ZONA_ARGENTINA);
}

const esNumeroPositivo = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Lee la respuesta de dolarapi.com; `null` si no trae una cotización válida. Sin `fechaActualizacion`, el día es el de `ahora`. */
export function leerDolarApi(json: unknown, ahora: Date): CotizacionDia | null {
  const j = json as { compra?: unknown; venta?: unknown; fechaActualizacion?: unknown } | null;
  if (!j || !esNumeroPositivo(j.venta)) return null;
  const instante = typeof j.fechaActualizacion === "string" ? new Date(j.fechaActualizacion) : ahora;
  if (Number.isNaN(instante.getTime())) return null;
  return { fecha: fechaArgentina(instante), compra: esNumeroPositivo(j.compra) ? j.compra : null, venta: j.venta, fuente: "BNA" };
}

/** Lee la respuesta del BCRA (un solo valor: va en `venta`); `null` si no trae una cotización válida. */
export function leerBcra(json: unknown): CotizacionDia | null {
  const j = json as { results?: { fecha?: unknown; detalle?: { tipoCotizacion?: unknown }[] }[] } | null;
  const r = j?.results?.[0];
  const valor = r?.detalle?.[0]?.tipoCotizacion;
  if (!r || typeof r.fecha !== "string" || !esNumeroPositivo(valor)) return null;
  return { fecha: r.fecha, compra: null, venta: valor, fuente: "BCRA" };
}

/** Días del historial de argentinadatos desde `desdeISO` (inclusive), en orden. */
export function leerHistorial(json: unknown, desdeISO: string): CotizacionDia[] {
  if (!Array.isArray(json)) return [];
  const dias: CotizacionDia[] = [];
  for (const f of json as { fecha?: unknown; compra?: unknown; venta?: unknown }[]) {
    if (typeof f?.fecha !== "string" || f.fecha < desdeISO || !esNumeroPositivo(f.venta)) continue;
    dias.push({ fecha: f.fecha, compra: esNumeroPositivo(f.compra) ? f.compra : null, venta: f.venta, fuente: "BNA" });
  }
  return dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/**
 * ¿Hay que rellenar el historial? Sí si la tabla está vacía o el último día guardado de BNA tiene más de `DIAS_PARA_RELLENAR` días de antigüedad (respecto del día de
 * `ahora` en la zona de Argentina). `desde` es el primer día a pedir: el siguiente al último guardado, nunca antes de `HISTORIAL_DESDE`.
 */
export function planDeRelleno(ultimaBna: Date | null, ahora: Date): { rellenar: false } | { rellenar: true; desde: string } {
  const hoyISO = fechaArgentina(ahora);
  const diasSinDatos = ultimaBna ? Math.floor((new Date(hoyISO).getTime() - ultimaBna.getTime()) / 86_400_000) : Infinity;
  if (diasSinDatos <= DIAS_PARA_RELLENAR) return { rellenar: false };
  const desde = ultimaBna ? new Date(ultimaBna.getTime() + 86_400_000).toISOString().slice(0, 10) : HISTORIAL_DESDE;
  return { rellenar: true, desde: desde < HISTORIAL_DESDE ? HISTORIAL_DESDE : desde };
}

/** Variación máxima aceptada contra la última cotización guardada (informe de seguridad 2026-10-01, S-19: una API de terceros comprometida o con un error no puede fijar un dólar absurdo). */
const VARIACION_MAXIMA_DOLAR = 0.2;
/** Pasada esta antigüedad de la última cotización guardada ya no se compara (una devaluación real acumula más que eso en un hueco largo). */
const DIAS_VIGENCIA_COMPARACION = 7;
/** Dos fuentes independientes que coinciden dentro de este margen confirman un salto grande (una devaluación legítima). */
const TOLERANCIA_ENTRE_FUENTES = 0.05;

/**
 * ¿La cotización nueva es creíble frente a la última guardada? Dentro de ±20% (o sin una última reciente, o sin dato previo): sí. Más
 * allá, solo si otra fuente independiente (`confirmacion`) da un valor dentro del 5% del nuevo; si no, no se guarda y se avisa.
 */
export function cotizacionPlausible(nueva: number, ultima: { fecha: Date; venta: number } | null, ahora: Date, confirmacion: number | null = null): boolean {
  if (!ultima) return true;
  const dias = (ahora.getTime() - ultima.fecha.getTime()) / 86_400_000;
  if (dias > DIAS_VIGENCIA_COMPARACION) return true;
  if (Math.abs(nueva / ultima.venta - 1) <= VARIACION_MAXIMA_DOLAR) return true;
  return confirmacion !== null && Math.abs(nueva / confirmacion - 1) <= TOLERANCIA_ENTRE_FUENTES;
}

/** El texto del error cuando se descarta una cotización por apartarse de la última guardada sin que otra fuente la confirme. */
export function mensajeDeCotizacionDescartada(venta: number, previaVenta: number | undefined): string {
  return `cotización descartada: ${venta} se aparta más de ${VARIACION_MAXIMA_DOLAR * 100}% de la última guardada (${previaVenta}) y no la confirma otra fuente`;
}

/** Pesos → dólares, con 2 decimales, a la cotización dada (se usa la de VENTA: lo que costaría comprar esos dólares). */
export function pesosADolares(pesos: number, cotizacionVenta: number): number {
  return Math.round((pesos / cotizacionVenta) * 100) / 100;
}

/**
 * ¿Falta la cotización de HOY? (horario argentino). Es la señal para que la aplicación se ponga al día sola cuando el cron no llegó a
 * correr (los crons del plan Hobby de Vercel corren en cualquier momento de la hora programada y no dan garantías). Un fin de semana
 * o un feriado la API devuelve el último valor hábil: se vuelve a pedir, y como el guardado es un `upsert` por día no ensucia nada.
 */
export function cotizacionVencida(ultima: { fecha: Date } | null, ahora: Date): boolean {
  if (!ultima) return true;
  return ultima.fecha.toISOString().slice(0, 10) < fechaArgentina(ahora);
}

export interface ResultadoSincronizacionDolar {
  diasRellenados: number;
  hoy: CotizacionDia | null;
  fuente: "BNA" | "BCRA" | null;
  errores: string[];
}
