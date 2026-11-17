import "server-only";
import type { Db } from "@/lib/db-tipos";
import { diaDeColumnaDate, fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";

/**
 * Lecturas de la JORNADA de la sucursal (caja, cierre del día, etapa A, 2026-11-17; docs/diseno-caja-cierre-del-dia-acciones-y-permisos-2026-11-17.md §5): el estado de una jornada por su fecha de negocio y la lista de jornadas,
 * más recientes primero y paginadas por cursor. SOLO LECTURA, siempre con la sucursal recibida (la del contexto; además de la RLS). Sin dinero ni datos personales: solo estado, momentos y ids de quienes actuaron.
 */
export const TAMANO_PAGINA_DE_JORNADAS = 30;

export interface EstadoDeJornada {
  jornadaId: string;
  /** «AAAA-MM-DD». */
  fechaDeNegocio: string;
  /** ABIERTA | EN_AUDITORIA | CERRADA. */
  estado: string;
  auditoriaIniciadaEn: Date | null;
  auditoriaIniciadaPorId: string | null;
  cerradaEn: Date | null;
  cerradaPorId: string | null;
  observacion: string | null;
  /** Las sesiones de caja que sellaron este día en la sucursal, en el orden en que se abrieron. */
  sesiones: readonly { sesionId: string; estado: string; abiertaEn: Date; abiertaPorId: string }[];
}

/** La jornada de la sucursal en esa fecha de negocio, o `null` si ese día todavía no tuvo actividad. */
export async function consultarEstadoDeJornada(sucursalId: string, fechaDeNegocio: string, db: Db): Promise<EstadoDeJornada | null> {
  const dia = fechaDeColumnaDate(fechaDeNegocio);
  const j = await db.jornadaDeSucursal.findFirst({
    where: { sucursalId, fechaDeNegocio: dia },
    select: { id: true, fechaDeNegocio: true, estado: true, auditoriaIniciadaEn: true, auditoriaIniciadaPorId: true, cerradaEn: true, cerradaPorId: true, observacion: true },
  });
  if (j === null) return null;
  const sesiones = await db.sesionCaja.findMany({ where: { sucursalId, fechaDeNegocio: dia }, orderBy: [{ abiertaEn: "asc" }, { id: "asc" }], select: { id: true, estado: true, abiertaEn: true, abiertaPorId: true } });
  return {
    jornadaId: j.id,
    fechaDeNegocio: diaDeColumnaDate(j.fechaDeNegocio),
    estado: j.estado,
    auditoriaIniciadaEn: j.auditoriaIniciadaEn,
    auditoriaIniciadaPorId: j.auditoriaIniciadaPorId,
    cerradaEn: j.cerradaEn,
    cerradaPorId: j.cerradaPorId,
    observacion: j.observacion,
    sesiones: sesiones.map((s) => ({ sesionId: s.id, estado: s.estado, abiertaEn: s.abiertaEn, abiertaPorId: s.abiertaPorId })),
  };
}

export interface JornadaDeLaLista {
  jornadaId: string;
  fechaDeNegocio: string;
  estado: string;
  auditoriaIniciadaEn: Date | null;
  cerradaEn: Date | null;
  cerradaPorId: string | null;
}

export interface PaginaDeJornadas {
  items: JornadaDeLaLista[];
  nextCursor: string | null;
}

/** Las jornadas de la sucursal, la fecha de negocio más reciente primero, de a `TAMANO_PAGINA_DE_JORNADAS`; `cursor` es el `nextCursor` de la página anterior. */
export async function listarJornadas(args: { sucursalId: string; cursor?: string }, db: Db): Promise<PaginaDeJornadas> {
  const filas = await db.jornadaDeSucursal.findMany({
    where: { sucursalId: args.sucursalId },
    orderBy: [{ fechaDeNegocio: "desc" }, { id: "desc" }],
    take: TAMANO_PAGINA_DE_JORNADAS + 1,
    ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    select: { id: true, fechaDeNegocio: true, estado: true, auditoriaIniciadaEn: true, cerradaEn: true, cerradaPorId: true },
  });
  const hayMas = filas.length > TAMANO_PAGINA_DE_JORNADAS;
  const pagina = hayMas ? filas.slice(0, TAMANO_PAGINA_DE_JORNADAS) : filas;
  return {
    items: pagina.map((f) => ({ jornadaId: f.id, fechaDeNegocio: diaDeColumnaDate(f.fechaDeNegocio), estado: f.estado, auditoriaIniciadaEn: f.auditoriaIniciadaEn, cerradaEn: f.cerradaEn, cerradaPorId: f.cerradaPorId })),
    nextCursor: hayMas ? pagina[pagina.length - 1]!.id : null,
  };
}
