import type { Responsable } from "./tipos";

/**
 * La política de gobierno de las excepciones y la deuda de los contratos (decisión del dueño). Los plazos son los que el dueño todavía tiene que CONFIRMAR: viven acá,
 * en un solo lugar, y los tests de borde usan literales (no estas constantes) para que cambiarlos obligue a tocar los tests.
 */

/** Un motivo (o un `porQue`) necesita al menos esta cantidad de caracteres. */
export const MOTIVO_MINIMO = 20;

/** Quién puede responder por una excepción o una deuda. Lista cerrada (el tipo `Responsable` la acompaña). */
export const RESPONSABLES: readonly Responsable[] = ["dueño"];

/** Una excepción no puede vencer más de estos días después de su última renovación (o de su creación). */
const HORIZONTE_EXCEPCION_DIAS = 365;
/** Una deuda no puede vencer más de estos días después de su última renovación (o de su creación). */
const HORIZONTE_DEUDA_DIAS = 60;
/** Una deuda con MÁS renovaciones que estas se avisa en el reporte, sin fallar. */
export const RENOVACIONES_SIN_AVISO = 2;
/** Lo que vence dentro de estos días (o menos) se avisa en el reporte, sin fallar. */
const AVISO_DE_VENCIMIENTO_DIAS = 14;

/** La referencia de una aprobación: `PR #12`, `commit 1f8d2c5c` (7 a 40 hexadecimales en minúscula) o `DEC-01`. */
const RE_REFERENCIA = /^(?:PR #\d+|commit [0-9a-f]{7,40}|DEC-\d{2,})$/;
export const referenciaValida = (referencia: string): boolean => RE_REFERENCIA.test(referencia);

/** Una fecha `AAAA-MM-DD` que existe en el calendario (no `2026-02-30`). */
export function esFechaValida(fecha: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const t = Date.parse(`${fecha}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === fecha;
}

/** El día de hoy en UTC (`AAAA-MM-DD`). No lee ninguna variable de entorno: el reloj es el del sistema y no se puede torcer desde afuera. */
export const fechaUtcDeHoy = (): string => new Date().toISOString().slice(0, 10);

const DIA_MS = 86_400_000;
const diasEntre = (desde: string, hasta: string): number => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS);

export interface EntradaConVencimiento {
  clase: "excepcion" | "deuda";
  archivo: string;
  fragmento: string;
  /** `AAAA-MM-DD`: desde acá se cuenta el plazo: la fecha de la última renovación, o la de creación si no hubo. */
  inicio: string;
  /** `AAAA-MM-DD`: la entrada rige hasta el final de ese día. */
  vence: string;
}

export interface Vencimientos {
  /** Su día ya pasó (`vence` anterior a hoy). */
  vencidas: EntradaConVencimiento[];
  /** Vencen más de `tope` días después de su inicio, o su inicio es posterior a hoy. */
  excedidas: (EntradaConVencimiento & { tope: number })[];
  /** Vigentes que vencen dentro del plazo de aviso (hoy incluido), con los días que faltan. */
  porVencer: (EntradaConVencimiento & { dias: number })[];
}

/**
 * Función pura: `hoy` (`AAAA-MM-DD`) se inyecta. El plazo se cuenta desde `inicio` (no desde hoy: renovar no regala plazo nuevo sin justificarlo). Una entrada rige hasta el final de su `vence` (igual que `evaluarAuditoria` de
 * `src/core/seguridad/auditoria-dependencias.ts`): vence hoy → vigente; vence ayer → vencida.
 */
export function evaluarVencimientos(entradas: readonly EntradaConVencimiento[], hoy: string): Vencimientos {
  const salida: Vencimientos = { vencidas: [], excedidas: [], porVencer: [] };
  for (const e of entradas) {
    const dias = diasEntre(hoy, e.vence);
    if (dias < 0) salida.vencidas.push(e);
    else {
      const tope = e.clase === "excepcion" ? HORIZONTE_EXCEPCION_DIAS : HORIZONTE_DEUDA_DIAS;
      if (diasEntre(e.inicio, e.vence) > tope || e.inicio > hoy) salida.excedidas.push({ ...e, tope });
      if (dias <= AVISO_DE_VENCIMIENTO_DIAS) salida.porVencer.push({ ...e, dias });
    }
  }
  return salida;
}
