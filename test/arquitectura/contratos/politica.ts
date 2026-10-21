import type { Responsable } from "./tipos";

/**
 * La política de gobierno de las excepciones y la deuda de los contratos (decisión del dueño). Los plazos viven acá, en un solo lugar, y los tests de borde usan literales
 * (no estas constantes) para que cambiarlos obligue a tocar los tests.
 *
 * Decisión del dueño (paso G1b): «cualquier excepción requiere justificación y aprobación explícitas, responsable y fecha de vencimiento, con un máximo de 60 días».
 * Vale para TODA excepción (las de los contratos, las exclusiones de clasificación de `gobernanza/exclusiones.ts`) y para la deuda. Lo que es legítimo y permanente no
 * es una excepción: es parte de la definición del contrato (`casosLegitimos`, sin vencimiento; ver `LEEME.md`).
 */

/** Un motivo (o un `porQue`) necesita al menos esta cantidad de caracteres. */
export const MOTIVO_MINIMO = 20;

/** Quién puede responder por una excepción o una deuda. Lista cerrada (el tipo `Responsable` la acompaña). */
export const RESPONSABLES: readonly Responsable[] = ["dueño"];

/** Una excepción no puede vencer más de estos días después de su última renovación (o de su creación): tope de 60 días por decisión del dueño (G1b), el mismo que la deuda. */
const HORIZONTE_EXCEPCION_DIAS = 60;
/** Una deuda no puede vencer más de estos días después de su última renovación (o de su creación): tope de 60 días por decisión del dueño (G1b), el mismo que la excepción. */
const HORIZONTE_DEUDA_DIAS = 60;
/** Una deuda con MÁS renovaciones que estas se avisa en el reporte, sin fallar. */
export const RENOVACIONES_SIN_AVISO = 2;
/** Lo que vence dentro de estos días (o menos) se avisa en el reporte, sin fallar. */
const AVISO_DE_VENCIMIENTO_DIAS = 14;

/**
 * El PISO de archivos que el motor tiene que haber LEÍDO al correr sobre el repo real (`Resumen.archivosLeidos`): lo que separa «pasó» de «no encontró nada». Un guardián que recorre 12 archivos en vez
 * de 2.500 (una carpeta movida, un recorrido que falla en silencio, un filtro) no encuentra nada y dice «verde»; la evidencia por corrida (`ejecutar.ts`, encadenado en `npm run arquitectura`) falla si se leyó
 * menos que esto. Se fijó en el 90 % de lo medido el 2026-10-21 (2.505 archivos leídos → 2.254, el 90 % redondeado hacia abajo): el repo crece más de lo que se achica, así que el piso no estorba, y bajarlo es cambiar este archivo, que
 * está congelado por hash en el registro de aprobaciones. Subirlo con el repo es lo esperable (volver a medir con `npm run arquitectura` y tomar el 90 %).
 */
export const PISO_DE_ARCHIVOS_LEIDOS = 2254;

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
/** Los días de calendario de `desde` a `hasta` (`AAAA-MM-DD`); negativo si `hasta` es anterior. Lo usan el vencimiento y la evidencia por corrida (`gobernanza/evidencia.ts`). */
export const diasEntre = (desde: string, hasta: string): number => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS);

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
