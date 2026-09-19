import { prisma } from "@/lib/db";
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

/** Fecha (YYYY-MM-DD) en horario argentino (UTC-3, sin horario de verano) de un instante. */
export function fechaArgentina(instante: Date): string {
  return new Date(instante.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
export async function sincronizarDolar(db: Db = prisma, ahora: Date = new Date()): Promise<ResultadoSincronizacionDolar> {
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
  if (hoy) await guardarDia(db, hoy);
  else if (diasRellenados === 0) throw new Error(`No se pudo obtener el dólar: ${errores.join("; ")}`);

  return { diasRellenados, hoy, fuente: hoy?.fuente ?? null, errores };
}

/** La cotización más reciente guardada (la de BNA si hay; si no, la del BCRA), o `null` si todavía no hay ninguna. */
export async function obtenerUltimaCotizacion(db: Db = prisma): Promise<UltimaCotizacion | null> {
  const fila = await db.cotizacionDolar.findFirst({ orderBy: [{ fecha: "desc" }, { fuente: "desc" }] });
  if (!fila) return null;
  return { fecha: fila.fecha, compra: fila.compra !== null ? Number(fila.compra) : null, venta: Number(fila.venta), fuente: fila.fuente };
}

/** Pesos → dólares, con 2 decimales, a la cotización dada (se usa la de VENTA: lo que costaría comprar esos dólares). */
export function pesosADolares(pesos: number, cotizacionVenta: number): number {
  return Math.round((pesos / cotizacionVenta) * 100) / 100;
}
