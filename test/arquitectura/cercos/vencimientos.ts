import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { esFechaValida, evaluarVencimientos, MOTIVO_MINIMO, referenciaValida, RESPONSABLES, type EntradaConVencimiento } from "../contratos/politica";
import type { Aprobacion, Responsable } from "../contratos/tipos";

/**
 * Fecha de vencimiento de la DEUDA de los cercos (lote 0 de «bajar la deuda»; diseño `docs/diseno-flujos-y-pasos-2026-11-06.md`, etapa E4).
 *
 * Necesidad: la regla G1b del dueño («toda excepción o deuda lleva responsable, aprobación y vencimiento, con un máximo de 60 días», `contratos/politica.ts`) solo la cumplían los contratos; las
 * listas de deuda de `linea-de-base/*.json` (los cercos) no tenían fecha y sus metas («Fase 6», «lote 6.33», «Fase 2») ya habían pasado. Decisión del dueño (2026-11-06): 60 días, y la idea es
 * atender TODA la deuda; este lote solo la FECHA, no paga nada.
 *
 * Forma más barata: una fecha POR LISTA (no por entrada), escrita acá y no en los JSON, así las líneas de base no se tocan y el trinquete sigue igual. Se reusa `evaluarVencimientos` de la política.
 * Reglas (las revisa `vencimientos.test.ts`):
 *  - Toda lista de `linea-de-base/` con entradas tiene su vencimiento acá, y no sobra ninguno (una lista que llegó a 0 se saca de este registro).
 *  - La fecha vence como mucho 60 días después de `inicio`; vencida, el gate falla. A 14 días o menos se avisa en la salida del test, sin fallar.
 *  - Renovar = cambiar `inicio` y `vence` con un motivo nuevo y una aprobación nueva (no se renueva en silencio: es un cambio visible en la revisión).
 */
export interface VencimientoDeLista {
  /** El nombre de la regla = el del JSON (`linea-de-base/<regla>.json`). */
  regla: string;
  /** `AAAA-MM-DD`: desde acá se cuenta el plazo (el día que se fechó, o el de la última renovación). */
  inicio: string;
  /** `AAAA-MM-DD`: rige hasta el final de ese día. */
  vence: string;
  responsable: Responsable;
  aprobacion: Aprobacion;
  /** Por qué esta fecha (20 caracteres o más). */
  motivo: string;
}

const APROBACION: Aprobacion = { por: "dueño", referencia: "PR #165" };
const INICIO = "2026-11-06";
const MOTIVO = "Deuda heredada con la meta vieja ya pasada: se fecha sin pagarla en este lote; fecha escalonada por riesgo de negocio (propuesta, la corrige el dueño).";

const lista = (regla: string, vence: string, aprobacion: Aprobacion = APROBACION, motivo: string = MOTIVO): VencimientoDeLista => ({ regla, inicio: INICIO, vence, responsable: "dueño", aprobacion, motivo });

/** Escalonadas entre 2026-12-03 y 2027-01-05 (el tope de 60 días desde 2026-11-06), de más a menos riesgo: dinero, escritores, permisos, fechas y números, presentación. */
export const VENCIMIENTOS_DE_LISTAS: readonly VencimientoDeLista[] = [
  lista("anuladas-en-consultas", "2026-12-02", { por: "dueño", referencia: "PR #177" }, "Deuda nueva al ampliar el guardián de anuladas a server/consultas y server/lecturas (lote 2, 2026-11-06): se declara sin pagarla, a 60 días como máximo."),
  lista("primitivas-de-dominio", "2026-12-04"),
  lista("dueno-unico-por-modelo", "2026-12-08"),
  lista("casos-de-uso-en-guardianes", "2026-12-11"),
  lista("fecha-de-texto-a-mano", "2026-12-15"),
  lista("inputmode-numerico-a-mano", "2026-12-22"),
  lista("controles-a-mano", "2026-12-28"),
  lista("dialogos-y-avisos-a-mano", "2026-12-30"),
  lista("tipografia", "2027-01-02"),
  lista("colores-de-escala", "2027-01-04"),
  lista("colores", "2027-01-05"),
  // PROPUESTA (E-N salida, 2026-11-09): deuda nueva al crear el guardián de números mostrados sin la función central; se declara sin pagarla toda en esta etapa. La aprobación queda PENDIENTE del dueño al mergear el PR de la etapa.
  lista("numero-sin-formato-central", "2027-01-03", { por: "dueño (pendiente de aprobar al mergear el PR)", referencia: "commit 58f066f2" }, "Deuda nueva al crear el guardián «número mostrado sin la función central» (regla de números del dueño, 2026-11-09): reportes, carta pública y mensajes de periodo pasan a la función central en las etapas siguientes (propuesta, la corrige el dueño)."),
  // Estructura de pantalla (PR #219, 2026-11-09): las 90 pantallas se adoptan por etapas E-B…E-H (docs/diseno-estructura-de-pantalla-1366x768-2026-11-09.md, §12). Plazo máximo; se renueva con motivo si una etapa se atrasa.
  {
    regla: "pantallas-con-estructura",
    inicio: "2026-11-09",
    vence: "2027-01-08",
    responsable: "dueño",
    aprobacion: { por: "dueño", referencia: "PR #219" },
    motivo: "Adopción del estándar de estructura de pantalla pantalla por pantalla, en las etapas E-B a E-H del diseño (propuesta de plazo: 60 días; la corrige el dueño).",
  },
];

/** Una lista de deuda del disco: cuántas entradas (archivos o modelos) tiene hoy. */
export interface ListaDeDeuda {
  regla: string;
  entradas: number;
}

/** Lee `linea-de-base/*.json` (cada JSON trae `regla` y `entradas`). */
export function leerListasDeDeuda(dirLineaDeBase: string): ListaDeDeuda[] {
  return readdirSync(dirLineaDeBase)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const json = JSON.parse(readFileSync(join(dirLineaDeBase, f), "utf8")) as { regla: string; entradas: number };
      return { regla: json.regla, entradas: json.entradas };
    });
}

export interface RevisionDeVencimientos {
  /** Lo que hace fallar el test. */
  problemas: string[];
  /** Vencen dentro del plazo de aviso: se muestran, no fallan. */
  avisos: string[];
}

/** Función pura (`hoy` se inyecta, `AAAA-MM-DD`): cruza las listas de deuda con el registro de vencimientos. */
export function revisarVencimientos(listas: readonly ListaDeDeuda[], registro: readonly VencimientoDeLista[], hoy: string): RevisionDeVencimientos {
  const problemas: string[] = [];
  const avisos: string[] = [];
  const conDeuda = new Map(listas.filter((l) => l.entradas > 0).map((l) => [l.regla, l.entradas]));
  const conocidas = new Set(listas.map((l) => l.regla));
  const vistas = new Set<string>();
  const entradas: EntradaConVencimiento[] = [];

  for (const v of registro) {
    if (vistas.has(v.regla)) problemas.push(`Vencimiento repetido para «${v.regla}».`);
    vistas.add(v.regla);
    if (!conocidas.has(v.regla)) problemas.push(`Vencimiento de «${v.regla}»: no existe esa lista en linea-de-base/ (sacalo de VENCIMIENTOS_DE_LISTAS).`);
    else if (!conDeuda.has(v.regla)) problemas.push(`Vencimiento que sobra: «${v.regla}» ya está en 0 (sacalo de VENCIMIENTOS_DE_LISTAS).`);
    if (!esFechaValida(v.inicio) || !esFechaValida(v.vence)) {
      problemas.push(`«${v.regla}»: inicio («${v.inicio}») y vence («${v.vence}») tienen que ser fechas AAAA-MM-DD reales.`);
      continue;
    }
    if (!RESPONSABLES.includes(v.responsable)) problemas.push(`«${v.regla}»: responsable «${v.responsable}» no está en la lista cerrada (${RESPONSABLES.join(", ")}).`);
    if (!referenciaValida(v.aprobacion.referencia) || v.aprobacion.por.trim() === "") problemas.push(`«${v.regla}»: la aprobación necesita quién (por) y una referencia válida (PR #n, commit <sha> o DEC-nn).`);
    if (v.motivo.trim().length < MOTIVO_MINIMO) problemas.push(`«${v.regla}»: el motivo necesita al menos ${MOTIVO_MINIMO} caracteres.`);
    entradas.push({ clase: "deuda", archivo: `linea-de-base/${v.regla}.json`, fragmento: v.regla, inicio: v.inicio, vence: v.vence });
  }

  for (const [regla, n] of conDeuda) {
    if (!vistas.has(regla)) problemas.push(`La lista «${regla}» tiene ${n} entradas de deuda y NO tiene fecha de vencimiento: agregala a VENCIMIENTOS_DE_LISTAS en cercos/vencimientos.ts (máximo 60 días desde hoy, con aprobación).`);
  }

  const { vencidas, excedidas, porVencer } = evaluarVencimientos(entradas, hoy);
  for (const e of vencidas) problemas.push(`La deuda «${e.fragmento}» VENCIÓ el ${e.vence}: pagala (bajá la lista) o renovala en cercos/vencimientos.ts con inicio/vence nuevos, motivo y aprobación (máximo 60 días).`);
  for (const e of excedidas) problemas.push(`La deuda «${e.fragmento}» vence el ${e.vence}, más de ${e.tope} días después de su inicio (${e.inicio}), o su inicio es posterior a hoy.`);
  for (const e of porVencer) avisos.push(`La deuda «${e.fragmento}» vence en ${e.dias} día(s), el ${e.vence}.`);
  return { problemas, avisos };
}
