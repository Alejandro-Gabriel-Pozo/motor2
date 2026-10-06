import { ZONA_ARGENTINA, diaDeCalendario } from "@/core/tiempo/zona-horaria";
import { reportarError, reportarErrorUnaVez } from "@/lib/reportar-error";
import type { Db } from "./comun";

/**
 * Dólar oficial del Banco Nación, para ver precios y valores también en dólares (Resumen, Período, Valuación y el encabezado).
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
const URL_HOY = "https://dolarapi.com/v1/dolares/oficial";
const URL_HISTORIAL = "https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial";
const URL_BCRA = "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD";
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

/** Lee la respuesta de dolarapi.com; `null` si no trae una cotización válida. */
export function leerDolarApi(json: unknown): CotizacionDia | null {
  const j = json as { compra?: unknown; venta?: unknown; fechaActualizacion?: unknown } | null;
  if (!j || !esNumeroPositivo(j.venta)) return null;
  const instante = typeof j.fechaActualizacion === "string" ? new Date(j.fechaActualizacion) : new Date();
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

async function pedir(url: string): Promise<unknown> {
  const resp = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) throw new Error(`${new URL(url).host} respondió ${resp.status}`);
  return resp.json();
}

async function guardarDia(db: Db, dia: CotizacionDia): Promise<void> {
  const fecha = new Date(dia.fecha); // medianoche UTC del día: mismo criterio que el resto del proyecto
  await db.cotizacionDolar.upsert({
    where: { fecha_fuente: { fecha, fuente: dia.fuente } },
    create: { fecha, fuente: dia.fuente, compra: dia.compra, venta: dia.venta },
    update: { compra: dia.compra, venta: dia.venta },
  });
}

export interface ResultadoSincronizacionDolar {
  diasRellenados: number;
  hoy: CotizacionDia | null;
  fuente: "BNA" | "BCRA" | null;
  errores: string[];
}

/**
 * Guarda la cotización de hoy (la del día se ACTUALIZA: queda la última corrida) y, si la tabla está vacía o el último día guardado
 * es viejo, rellena antes el historial desde argentinadatos. Un fallo de una fuente no tira abajo la corrida: se prueba la siguiente y
 * los errores se devuelven. Si NINGUNA fuente da la cotización de hoy y no se rellenó nada, lanza (el cron responde 502).
 */
export async function sincronizarDolar(db: Db, ahora: Date = new Date()): Promise<ResultadoSincronizacionDolar> {
  const errores: string[] = [];
  let diasRellenados = 0;

  const ultima = await db.cotizacionDolar.findFirst({ where: { fuente: "BNA" }, orderBy: { fecha: "desc" } });
  const hoyISO = fechaArgentina(ahora);
  const diasSinDatos = ultima ? Math.floor((new Date(hoyISO).getTime() - ultima.fecha.getTime()) / 86_400_000) : Infinity;
  if (diasSinDatos > DIAS_PARA_RELLENAR) {
    try {
      const desde = ultima ? new Date(ultima.fecha.getTime() + 86_400_000).toISOString().slice(0, 10) : HISTORIAL_DESDE;
      for (const dia of leerHistorial(await pedir(URL_HISTORIAL), desde < HISTORIAL_DESDE ? HISTORIAL_DESDE : desde)) {
        await guardarDia(db, dia);
        diasRellenados++;
      }
    } catch (e) {
      errores.push(`historial: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let hoy: CotizacionDia | null = null;
  try {
    hoy = leerDolarApi(await pedir(URL_HOY));
    if (!hoy) errores.push("dolarapi.com no trajo una cotización válida");
  } catch (e) {
    errores.push(`dolarapi.com: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!hoy) {
    try {
      hoy = leerBcra(await pedir(URL_BCRA));
      if (!hoy) errores.push("BCRA no trajo una cotización válida");
    } catch (e) {
      errores.push(`BCRA: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (hoy) {
    const fila = await db.cotizacionDolar.findFirst({ where: { fecha: { lt: new Date(hoy.fecha) } }, orderBy: [{ fecha: "desc" }, { fuente: "desc" }] });
    const previa = fila ? { fecha: fila.fecha, venta: Number(fila.venta) } : null;
    if (!cotizacionPlausible(hoy.venta, previa, ahora)) {
      let confirmacion: number | null = null;
      try {
        const otra = hoy.fuente === "BNA" ? leerBcra(await pedir(URL_BCRA)) : leerDolarApi(await pedir(URL_HOY));
        confirmacion = otra?.venta ?? null;
      } catch {
        // sin segunda fuente no hay confirmación: el salto se descarta
      }
      if (!cotizacionPlausible(hoy.venta, previa, ahora, confirmacion)) {
        errores.push(`cotización descartada: ${hoy.venta} se aparta más de ${VARIACION_MAXIMA_DOLAR * 100}% de la última guardada (${previa?.venta}) y no la confirma otra fuente`);
        hoy = null;
      }
    }
  }
  if (hoy) await guardarDia(db, hoy);
  else if (diasRellenados === 0) throw new Error(`No se pudo obtener el dólar: ${errores.join("; ")}`);

  return { diasRellenados, hoy, fuente: hoy?.fuente ?? null, errores };
}

/** La cotización más reciente guardada (la de BNA si hay; si no, la del BCRA), o `null` si todavía no hay ninguna. */
export async function obtenerUltimaCotizacion(db: Db): Promise<UltimaCotizacion | null> {
  const fila = await db.cotizacionDolar.findFirst({ orderBy: [{ fecha: "desc" }, { fuente: "desc" }] });
  if (!fila) return null;
  return { fecha: fila.fecha, compra: fila.compra !== null ? Number(fila.compra) : null, venta: Number(fila.venta), fuente: fila.fuente };
}

/**
 * Para las pantallas: el dólar es un extra (la equivalencia en US$), así que si la lectura falla la pantalla sigue sin él. Pero un fallo
 * NO se traga en silencio: queda en Sentry (una vez por arranque, para no gastar la cuota si la base está caída y todas las pantallas lo piden).
 */
export async function obtenerUltimaCotizacionSinRomper(db: Db): Promise<UltimaCotizacion | null> {
  try {
    return await obtenerUltimaCotizacion(db);
  } catch (e) {
    await reportarErrorUnaVez("cotizacion-lectura", e, "dolar-lectura");
    return null;
  }
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
export function cotizacionVencida(ultima: { fecha: Date } | null, ahora: Date = new Date()): boolean {
  if (!ultima) return true;
  return ultima.fecha.toISOString().slice(0, 10) < fechaArgentina(ahora);
}

const MINUTOS_ENTRE_INTENTOS = 15;
let ultimoIntentoMs = 0;

/** Solo para las pruebas: vuelve a habilitar el intento inmediato. */
export function reiniciarLimitadorDolar(): void {
  ultimoIntentoMs = 0;
}

/**
 * Se pone al día sin esperar al cron: intenta `sincronizarDolar` a lo sumo una vez cada 15 minutos por instancia del servidor (varias
 * pantallas abiertas a la vez no disparan varias sincronizaciones) y NUNCA lanza: un fallo de las APIs de terceros no puede romper la
 * pantalla desde la que se pidió. Devuelve `true` si intentó sincronizar.
 */
export async function actualizarDolarSiHaceFalta(db: Db, ahora: Date = new Date()): Promise<boolean> {
  if (process.env.MOTOR2_SIN_DOLAR_AUTOMATICO === "1") return false; // las pruebas de navegador no salen a internet
  if (ahora.getTime() - ultimoIntentoMs < MINUTOS_ENTRE_INTENTOS * 60_000) return false;
  ultimoIntentoMs = ahora.getTime();
  try {
    await sincronizarDolar(db, ahora);
  } catch (e) {
    console.error("[dolar] no se pudo actualizar la cotización:", e instanceof Error ? e.message : e);
    await reportarError(e, "dolar-autoactualizacion");
  }
  return true;
}
