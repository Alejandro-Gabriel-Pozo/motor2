import { MOTIVO_MINIMO, RESPONSABLES, esFechaValida, evaluarVencimientos, referenciaValida, type EntradaConVencimiento } from "../politica";
import type { Aprobacion, Responsable, TipoDeHallazgo } from "../tipos";

/**
 * Las EXCLUSIONES de la clasificación de rutas (ver `clasificacion.ts`): código que se decide NO clasificar. Es la única puerta para que un archivo versionado quede fuera de
 * las reglas, y por eso es angosta, escrita y con fecha:
 *  - `ruta`: una carpeta (termina en `/`) o un archivo, con `/`, sin comodines y con al menos dos tramos (no se puede excluir `src/` ni `docs/`);
 *  - `motivo`: 20 caracteres o más;
 *  - `responsable` de la lista cerrada y `aprobacion` con la referencia `PR #n`, `commit <sha>` o `DEC-nn` (la misma validación de forma que el motor de contratos);
 *  - `vence`: `AAAA-MM-DD`, rige hasta el final de ese día y como mucho 60 días después de HOY (tope de toda excepción, decisión del dueño: `politica.ts`) (el mismo `evaluarVencimientos` del motor);
 *  - `archivos`: la CANTIDAD EXACTA de archivos que hay hoy bajo la ruta. Un archivo más (código movido ahí adentro) es `exclusion-ampliada`; uno menos o ninguno, `exclusion-sin-uso`.
 * Sin campos opcionales: `tsc` rechaza una exclusión a la que le falte algo. Lo que no está versionado (`node_modules`, `.next`…) no se lista y no necesita exclusión.
 */
export interface Exclusion {
  ruta: string;
  motivo: string;
  responsable: Responsable;
  aprobacion: Aprobacion;
  vence: string;
  archivos: number;
}

/** El tope de archivos que puede cubrir UNA exclusión: más que esto no es una excepción acotada, es una carpeta que hay que clasificar. */
const MAXIMO_DE_ARCHIVOS_POR_EXCLUSION = 50;

export const EXCLUSIONES: readonly Exclusion[] = [
  {
    ruta: "prisma/fase-a/",
    motivo: "prototipo de la Fase A de multi-tenancy (ADR-004): schema, config y smoke test experimentales, aislados de prisma/schema.prisma a propósito; se corren a mano y nadie los importa",
    responsable: "dueño",
    // DEC-02: la decisión del dueño que fija el tope de 60 días para toda excepción (G1b). La exclusión no tiene `creada` ni renovaciones: el plazo se cuenta desde HOY, así que
    // al vencer se renueva escribiendo una nueva fecha de hasta 60 días desde ese día, con motivo y aprobación vigentes. Hoy es 2026-10-21: hoy + 60 días = 2026-12-20.
    aprobacion: { por: "dueño", referencia: "DEC-02" },
    vence: "2026-12-20",
    archivos: 5,
  },
];

/** Los hallazgos de gobierno de una exclusión reusan los nombres del motor de contratos (`tipos.ts`): mismo problema, mismo nombre. */
export type TipoDeProblemaDeExclusion = Extract<TipoDeHallazgo, "excepcion-sin-motivo" | "excepcion-sin-responsable" | "excepcion-sin-aprobacion" | "excepcion-vencida" | "horizonte-excedido">;

export interface ProblemaDeExclusion {
  tipo: TipoDeProblemaDeExclusion;
  ruta: string;
  que: string;
  como: string;
}

/** Cuánto falta para que venza una exclusión que vence pronto (aviso que no falla). */
export interface AvisoDeExclusion {
  ruta: string;
  vence: string;
  dias: number;
}

/** Cubre la ruta de la exclusión: una carpeta (con `/` final) contiene lo que empieza con ella; un archivo, solo a sí mismo. */
export const bajoLaExclusion = (e: Exclusion, ruta: string): boolean => (e.ruta.endsWith("/") ? ruta.startsWith(e.ruta) : ruta === e.ruta);

/** Una lista de exclusiones mal armada (ruta ancha o inválida, fecha que no existe, cantidad inválida, repetida o anidada) NO es un hallazgo: es un error del propio archivo. */
export function validarExclusiones(exclusiones: readonly Exclusion[]): void {
  const problemas: string[] = [];
  for (const e of exclusiones) {
    const en = `exclusión «${e.ruta}»`;
    const tramos = e.ruta.replace(/\/$/, "").split("/");
    if (e.ruta.startsWith("/") || e.ruta.includes("//") || tramos.includes("..") || tramos.includes(".")) problemas.push(`${en}: la ruta tiene que ser relativa a la raíz y con \`/\``);
    if (/[*?[\]{}]/.test(e.ruta)) problemas.push(`${en}: la ruta no admite comodines (es una carpeta con \`/\` final o un archivo)`);
    if (tramos.length < 2) problemas.push(`${en}: la ruta es demasiado ancha (al menos dos tramos, como \`prisma/fase-a/\`)`);
    if (!esFechaValida(e.vence)) problemas.push(`${en}: \`vence\` «${e.vence}» no es una fecha AAAA-MM-DD válida`);
    if (!Number.isInteger(e.archivos) || e.archivos < 0 || e.archivos > MAXIMO_DE_ARCHIVOS_POR_EXCLUSION) {
      problemas.push(`${en}: \`archivos\` tiene que ser un entero de 0 a ${MAXIMO_DE_ARCHIVOS_POR_EXCLUSION} (una exclusión acotada; más que eso se clasifica)`);
    }
  }
  const rutas = exclusiones.map((e) => e.ruta);
  if (new Set(rutas).size !== rutas.length) problemas.push("hay una ruta repetida en las exclusiones");
  for (const a of exclusiones) for (const b of exclusiones) if (a !== b && bajoLaExclusion(a, b.ruta)) problemas.push(`la exclusión «${b.ruta}» está dentro de «${a.ruta}»: dejá una sola`);
  if (problemas.length > 0) throw new Error(`Exclusiones de rutas mal armadas:\n${problemas.map((p) => `  - ${p}`).join("\n")}`);
}

/** El gobierno de cada exclusión: motivo, responsable, aprobación y vencimiento (con `hoy` inyectado; el plazo cuenta desde HOY, no hay `creada` ni renovaciones). */
export function revisarGobiernoDeExclusiones(exclusiones: readonly Exclusion[], hoy: string): { problemas: ProblemaDeExclusion[]; avisos: AvisoDeExclusion[] } {
  const problemas: ProblemaDeExclusion[] = [];
  const entradas: EntradaConVencimiento[] = [];
  for (const e of exclusiones) {
    const nombre = `la exclusión de «${e.ruta}»`;
    if (e.motivo.trim().length < MOTIVO_MINIMO) problemas.push({ tipo: "excepcion-sin-motivo", ruta: e.ruta, que: `${nombre} no tiene motivo (${MOTIVO_MINIMO} caracteres o más)`, como: "escribí por qué este código no se clasifica" });
    if (!RESPONSABLES.includes(e.responsable)) problemas.push({ tipo: "excepcion-sin-responsable", ruta: e.ruta, que: `${nombre} tiene un responsable que no es de la lista cerrada («${e.responsable}»)`, como: `poné uno de: ${RESPONSABLES.join(", ")}` });
    if (!e.aprobacion.por.trim() || !referenciaValida(e.aprobacion.referencia)) {
      problemas.push({ tipo: "excepcion-sin-aprobacion", ruta: e.ruta, que: `${nombre} no tiene aprobación válida (por «${e.aprobacion.por}», referencia «${e.aprobacion.referencia}»)`, como: "escribí quién la aprobó y la referencia: `PR #n`, `commit <sha>` o `DEC-nn`" });
    }
    entradas.push({ clase: "excepcion", archivo: e.ruta, fragmento: e.ruta, inicio: hoy, vence: e.vence });
  }
  const vencimientos = evaluarVencimientos(entradas, hoy);
  for (const v of vencimientos.vencidas) {
    problemas.push({ tipo: "excepcion-vencida", ruta: v.archivo, que: `la exclusión de «${v.archivo}» venció el ${v.vence} (hoy es ${hoy})`, como: "clasificá ese código con una regla y sacá la exclusión, o renovala con una nueva aprobación y otra fecha" });
  }
  for (const v of vencimientos.excedidas) {
    problemas.push({ tipo: "horizonte-excedido", ruta: v.archivo, que: `la exclusión de «${v.archivo}» vence el ${v.vence}, más de ${v.tope} días después de hoy (${hoy})`, como: "poné una fecha de vencimiento más cercana (el tope está en `politica.ts`)" });
  }
  return { problemas, avisos: vencimientos.porVencer.map((v) => ({ ruta: v.archivo, vence: v.vence, dias: v.dias })) };
}
