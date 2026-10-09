import { ZONA_ARGENTINA, diaDeCalendario, esDiaISOReal } from "@/core/tiempo/zona-horaria";

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

/**
 * Tope de una cotización aceptada de un tercero (S-30): el dólar vale ~1.500 pesos y la columna es `Decimal(12,4)` (hasta 99.999.999,9999). Un valor mayor es un error o un
 * ataque, nunca un dólar real, y uno que no entra en la columna revienta el guardado de TODA la corrida.
 */
const COTIZACION_MAXIMA = 1_000_000;
const esCotizacionValida = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= COTIZACION_MAXIMA;

/**
 * Lee la respuesta de dolarapi.com; `null` si no trae una cotización válida (venta positiva y acotada, fecha que se entienda y que no sea del futuro: lo que escribe un
 * tercero lo leen todas las empresas, S-30). Sin `fechaActualizacion`, el día es el de `ahora`.
 */
export function leerDolarApi(json: unknown, ahora: Date): CotizacionDia | null {
  const j = json as { compra?: unknown; venta?: unknown; fechaActualizacion?: unknown } | null;
  if (!j || !esCotizacionValida(j.venta)) return null;
  const instante = typeof j.fechaActualizacion === "string" ? new Date(j.fechaActualizacion) : ahora;
  if (Number.isNaN(instante.getTime())) return null;
  const fecha = fechaArgentina(instante);
  if (fecha > fechaArgentina(ahora)) return null;
  return { fecha, compra: esCotizacionValida(j.compra) ? j.compra : null, venta: j.venta, fuente: "BNA" };
}

/** Lee la respuesta del BCRA (un solo valor: va en `venta`); `null` si no trae una cotización válida (fecha «AAAA-MM-DD» real y no futura, valor acotado). */
export function leerBcra(json: unknown, ahora: Date): CotizacionDia | null {
  const j = json as { results?: { fecha?: unknown; detalle?: { tipoCotizacion?: unknown }[] }[] } | null;
  const r = j?.results?.[0];
  const valor = r?.detalle?.[0]?.tipoCotizacion;
  if (!r || !esDiaISOReal(r.fecha) || r.fecha > fechaArgentina(ahora) || !esCotizacionValida(valor)) return null;
  return { fecha: r.fecha, compra: null, venta: valor, fuente: "BCRA" };
}

/**
 * Días del historial de argentinadatos desde `desdeISO` (inclusive) hasta HOY en Argentina (inclusive), en orden. Se saltea la fila con una fecha que no existe o que es del
 * futuro y la de un valor fuera de rango (S-30); la plausibilidad contra el día anterior (`cotizacionPlausible`) la aplica el caso de uso al guardar.
 */
export function leerHistorial(json: unknown, desdeISO: string, ahora: Date): CotizacionDia[] {
  if (!Array.isArray(json)) return [];
  const hastaISO = fechaArgentina(ahora);
  const dias: CotizacionDia[] = [];
  for (const f of json as { fecha?: unknown; compra?: unknown; venta?: unknown }[]) {
    if (!esDiaISOReal(f?.fecha) || f.fecha < desdeISO || f.fecha > hastaISO || !esCotizacionValida(f.venta)) continue;
    dias.push({ fecha: f.fecha, compra: esCotizacionValida(f.compra) ? f.compra : null, venta: f.venta, fuente: "BNA" });
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
 * El ANCLA fija para cuando la tabla está vacía y no hay una cotización previa con que comparar (M-35 de la auditoría intermedia): el primer relleno del historial (`previo = null`) solo se
 * acotaba a `COTIZACION_MAXIMA` (1.000.000), o sea que una API de terceros comprometida podía escribir ahí un dólar de 500.000 en el primer día y quedar como base de todas las
 * comparaciones siguientes. Con el ancla, el primer valor tiene que caer en una banda realista alrededor de este valor de referencia (el dólar oficial verificado el 2026-09-19:
 * 1.485 / 1.535) que se abre con la antigüedad: `FACTOR_MAXIMO_ANUAL_SIN_ANCLA` por cada año de distancia entre la fecha de la cotización y la de la referencia (mínimo uno). 5 por año
 * deja pasar la peor devaluación anual reciente (2023: ~4,4×) y corta lo absurdo. Es un default a confirmar por el dueño, revertible cambiando estas dos constantes.
 */
const DOLAR_DE_REFERENCIA_SIN_ANCLA = { fecha: "2026-09-19", venta: 1500 } as const;
const FACTOR_MAXIMO_ANUAL_SIN_ANCLA = 5;

/** ¿El valor cae en la banda realista del ancla fija para la fecha dada? Sin previo con que comparar, esta es la única defensa contra un primer valor absurdo. */
function dentroDeLaBandaSinAncla(nueva: number, instante: Date): boolean {
  const dias = Math.abs(instante.getTime() - Date.parse(DOLAR_DE_REFERENCIA_SIN_ANCLA.fecha)) / 86_400_000;
  const factor = FACTOR_MAXIMO_ANUAL_SIN_ANCLA ** Math.max(1, Math.ceil(dias / 365));
  return nueva >= DOLAR_DE_REFERENCIA_SIN_ANCLA.venta / factor && nueva <= DOLAR_DE_REFERENCIA_SIN_ANCLA.venta * factor;
}

/**
 * ¿La cotización nueva es creíble frente a la última guardada? Dentro de ±20% (o sin una última reciente): sí. Más allá, solo si otra fuente independiente (`confirmacion`) da un valor
 * dentro del 5% del nuevo; si no, no se guarda y se avisa. SIN dato previo (tabla vacía) ya no se acepta cualquier valor: tiene que caer en la banda del ancla fija
 * (`DOLAR_DE_REFERENCIA_SIN_ANCLA`) o confirmarlo otra fuente (M-35). `ahora` es la fecha de la cotización cuando se rellena el historial.
 */
export function cotizacionPlausible(nueva: number, ultima: { fecha: Date; venta: number } | null, ahora: Date, confirmacion: number | null = null): boolean {
  if (!ultima) return dentroDeLaBandaSinAncla(nueva, ahora) || (confirmacion !== null && Math.abs(nueva / confirmacion - 1) <= TOLERANCIA_ENTRE_FUENTES);
  const dias = (ahora.getTime() - ultima.fecha.getTime()) / 86_400_000;
  if (dias > DIAS_VIGENCIA_COMPARACION) return true;
  if (Math.abs(nueva / ultima.venta - 1) <= VARIACION_MAXIMA_DOLAR) return true;
  return confirmacion !== null && Math.abs(nueva / confirmacion - 1) <= TOLERANCIA_ENTRE_FUENTES;
}

/** El texto del error cuando se descarta una cotización por apartarse de la última guardada sin que otra fuente la confirme. */
export function mensajeDeCotizacionDescartada(venta: number, previaVenta: number | undefined): string {
  return `cotización descartada: ${venta} se aparta más de ${VARIACION_MAXIMA_DOLAR * 100}% de la última guardada (${previaVenta}) y no la confirma otra fuente`;
}

/** Los códigos FIJOS con que el cron del dólar cuenta, hacia afuera, qué falló (M-27 de la auditoría intermedia). */
export type CodigoDeErrorDeSincronizacion = "historial" | "dolarapi" | "bcra" | "cotizacion-descartada" | "otro";

/**
 * Los errores que junta `sincronizarDolar` son texto libre y varios traen el `message` de una excepción (el de Prisma al guardar un día, el de `fetch`, hosts): el cron los devolvía crudos en
 * el cuerpo de su respuesta 200. Hacia afuera salen solo estos códigos fijos, sin repetir y en el orden en que aparecen; el detalle completo va a Sentry (`reportarError`), no a la respuesta.
 */
export function codigosDeErroresDeSincronizacion(errores: readonly string[]): CodigoDeErrorDeSincronizacion[] {
  const codigos: CodigoDeErrorDeSincronizacion[] = [];
  for (const error of errores) {
    const codigo: CodigoDeErrorDeSincronizacion = /cotización descartada/.test(error)
      ? "cotizacion-descartada"
      : error.startsWith("historial")
        ? "historial"
        : error.startsWith("dolarapi.com")
          ? "dolarapi"
          : error.startsWith("BCRA")
            ? "bcra"
            : "otro";
    if (!codigos.includes(codigo)) codigos.push(codigo);
  }
  return codigos;
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
