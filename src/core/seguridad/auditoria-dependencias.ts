/**
 * Evaluación de `npm audit` con una lista de excepciones que VENCEN (S-15, decisión del dueño 2026-10-02). `npm audit` sale con
 * código 1 por avisos altos de la cadena del CLI de Prisma que no se resuelven sin bajar Prisma: en vez de ignorar el comando (o
 * bajar el umbral) cada aviso aceptado queda anotado con su motivo y una fecha límite, y el comando vuelve a fallar solo cuando la
 * fecha pasa o aparece un aviso que no está en la lista.
 */

export interface ExcepcionDeAuditoria {
  /** Id del aviso, p. ej. `GHSA-ggr8-5vv4-36mx`. */
  aviso: string;
  paquete: string;
  motivo: string;
  /** Último día (inclusive) en que se acepta el aviso, `AAAA-MM-DD`. */
  venceElDia: string;
}

export interface AvisoAlto {
  aviso: string;
  paquete: string;
  severidad: string;
  titulo: string;
}

export interface ResultadoDeAuditoria {
  ok: boolean;
  /** Avisos altos/críticos que no tienen excepción. */
  sinExcepcion: AvisoAlto[];
  /** Avisos con excepción vencida. */
  vencidas: Array<AvisoAlto & { venceElDia: string }>;
  /** Avisos aceptados que siguen vigentes. */
  aceptadas: Array<AvisoAlto & { venceElDia: string; motivo: string }>;
  /** Excepciones de la lista que ya no corresponden a ningún aviso actual: conviene borrarlas. */
  sobrantes: ExcepcionDeAuditoria[];
}

const SEVERIDADES_QUE_FALLAN = new Set(["high", "critical"]);
const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

interface ViaDeAviso {
  source?: number;
  name?: string;
  title?: string;
  url?: string;
  severity?: string;
}

interface SalidaDeNpmAudit {
  vulnerabilities?: Record<string, { via?: Array<string | ViaDeAviso> }>;
}

function idDeAviso(via: ViaDeAviso): string {
  const desdeUrl = via.url?.match(/GHSA-[a-z0-9-]+/i)?.[0];
  return desdeUrl ?? (via.source !== undefined ? String(via.source) : (via.title ?? "desconocido"));
}

/** Los avisos altos y críticos de la salida de `npm audit --json`, sin repetir (el mismo aviso aparece por cada paquete que lo arrastra). */
export function extraerAvisosAltos(salida: SalidaDeNpmAudit): AvisoAlto[] {
  const porId = new Map<string, AvisoAlto>();
  for (const vulnerabilidad of Object.values(salida.vulnerabilities ?? {})) {
    for (const via of vulnerabilidad.via ?? []) {
      if (typeof via === "string") continue; // referencia a otro paquete: el aviso en sí aparece en ese paquete
      if (!SEVERIDADES_QUE_FALLAN.has(via.severity ?? "")) continue;
      const aviso = idDeAviso(via);
      if (!porId.has(aviso)) porId.set(aviso, { aviso, paquete: via.name ?? "desconocido", severidad: via.severity ?? "high", titulo: via.title ?? "" });
    }
  }
  return [...porId.values()];
}

/** Una excepción sin motivo o sin fecha válida es un error de la lista, no un aviso aceptado. */
export function validarExcepciones(excepciones: ExcepcionDeAuditoria[]): string[] {
  const errores: string[] = [];
  for (const e of excepciones) {
    if (!e.aviso.trim()) errores.push("Hay una excepción sin id de aviso.");
    if (!e.motivo.trim()) errores.push(`${e.aviso}: falta el motivo.`);
    if (!FORMATO_DIA.test(e.venceElDia) || Number.isNaN(Date.parse(`${e.venceElDia}T00:00:00Z`))) errores.push(`${e.aviso}: «${e.venceElDia}» no es una fecha AAAA-MM-DD válida.`);
  }
  return errores;
}

/** `hoy` es un día `AAAA-MM-DD`: una excepción rige hasta el final de su `venceElDia`. */
export function evaluarAuditoria(avisos: AvisoAlto[], excepciones: ExcepcionDeAuditoria[], hoy: string): ResultadoDeAuditoria {
  const porAviso = new Map(excepciones.map((e) => [e.aviso, e]));
  const resultado: ResultadoDeAuditoria = { ok: true, sinExcepcion: [], vencidas: [], aceptadas: [], sobrantes: [] };

  for (const a of avisos) {
    const excepcion = porAviso.get(a.aviso);
    if (!excepcion) resultado.sinExcepcion.push(a);
    else if (excepcion.venceElDia < hoy) resultado.vencidas.push({ ...a, venceElDia: excepcion.venceElDia });
    else resultado.aceptadas.push({ ...a, venceElDia: excepcion.venceElDia, motivo: excepcion.motivo });
  }
  const vistos = new Set(avisos.map((a) => a.aviso));
  resultado.sobrantes = excepciones.filter((e) => !vistos.has(e.aviso));
  resultado.ok = resultado.sinExcepcion.length === 0 && resultado.vencidas.length === 0;
  return resultado;
}
