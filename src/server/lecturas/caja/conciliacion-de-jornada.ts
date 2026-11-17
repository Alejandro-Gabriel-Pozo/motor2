import "server-only";
import type { Db } from "@/lib/db-tipos";
import { diaDeColumnaDate, fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import { centavosDeDecimal } from "./centavos-de-decimal";

/**
 * Lectura «conciliación congelada de una jornada cerrada» (caja, cierre del día, etapa A, 2026-11-17; C2b): lo que `cerrarJornada` guardó (la foto por medio, las cobranzas cuyo cobrado difiere del total del ticket y los controles con su reconocimiento).
 * SOLO LECTURA, de la sucursal recibida (la del contexto; además de la RLS). Es la foto: no recalcula nada. Importes en CENTAVOS como texto con signo (nunca `Decimal` ni `number`); la diferencia de cada línea es la columna que calcula la base.
 * `null` si la jornada no existe o todavía no está cerrada (no hay foto).
 */
export interface LineaDeConciliacionCongelada {
  medioDePagoId: string;
  tipoDeMedio: string;
  nombreDelMedio: string | null;
  registradoEnCentavos: string;
  correccionesEnCentavos: string;
  declaradoEnCentavos: string | null;
  /** CONTADO | DECLARADO | CONFORME | SIN_DATO. */
  estadoDeConteo: string;
  conformeEn: Date | null;
  /** Declarado − (registrado + correcciones), calculado por la base; `null` con CONFORME o SIN_DATO. */
  diferenciaEnCentavos: string | null;
  explicacion: string | null;
}

export interface OrigenDeConciliacionCongelado {
  cobranzaId: string;
  cobradoEnCentavos: string;
  totalDelTicketEnCentavos: string;
  diferenciaEnCentavos: string | null;
  explicacion: string | null;
}

export interface ControlCongelado {
  clave: string;
  severidad: string;
  cantidad: number;
  reconocido: boolean;
  texto: string | null;
}

export interface ConciliacionDeJornada {
  jornadaId: string;
  fechaDeNegocio: string;
  congeladoEn: Date;
  cerradaPorId: string | null;
  huellaDeCierre: string | null;
  observacion: string | null;
  lineas: readonly LineaDeConciliacionCongelada[];
  origenes: readonly OrigenDeConciliacionCongelado[];
  controles: readonly ControlCongelado[];
}

const texto = (d: Parameters<typeof centavosDeDecimal>[0]): string => centavosDeDecimal(d).toString();

export async function consultarConciliacionDeJornada(sucursalId: string, fechaDeNegocio: string, db: Db): Promise<ConciliacionDeJornada | null> {
  const j = await db.jornadaDeSucursal.findFirst({
    where: { sucursalId, fechaDeNegocio: fechaDeColumnaDate(fechaDeNegocio), estado: "CERRADA" },
    select: {
      id: true,
      fechaDeNegocio: true,
      huellaDeCierre: true,
      cerradaPorId: true,
      observacion: true,
      controles: { orderBy: { clave: "asc" }, select: { clave: true, severidad: true, cantidad: true, reconocido: true, texto: true } },
      cierreDeCaja: {
        select: {
          congeladoEn: true,
          lineas: { select: { medioDePagoId: true, registrado: true, correcciones: true, declarado: true, estadoDeConteo: true, conformeEn: true, diferencia: true, explicacion: true, medioDePago: { select: { tipo: true, nombre: true } } } },
          origenes: { select: { cobranzaId: true, cobrado: true, totalDelTicket: true, diferencia: true, explicacion: true } },
        },
      },
    },
  });
  if (j === null || j.cierreDeCaja === null) return null;
  const lineas = [...j.cierreDeCaja.lineas].sort((a, b) => (a.medioDePagoId < b.medioDePagoId ? -1 : a.medioDePagoId > b.medioDePagoId ? 1 : 0));
  const origenes = [...j.cierreDeCaja.origenes].sort((a, b) => (a.cobranzaId < b.cobranzaId ? -1 : a.cobranzaId > b.cobranzaId ? 1 : 0));
  return {
    jornadaId: j.id,
    fechaDeNegocio: diaDeColumnaDate(j.fechaDeNegocio),
    congeladoEn: j.cierreDeCaja.congeladoEn,
    cerradaPorId: j.cerradaPorId,
    huellaDeCierre: j.huellaDeCierre,
    observacion: j.observacion,
    lineas: lineas.map((l) => ({
      medioDePagoId: l.medioDePagoId,
      tipoDeMedio: l.medioDePago.tipo,
      nombreDelMedio: l.medioDePago.nombre,
      registradoEnCentavos: texto(l.registrado),
      correccionesEnCentavos: texto(l.correcciones),
      declaradoEnCentavos: l.declarado === null ? null : texto(l.declarado),
      estadoDeConteo: l.estadoDeConteo,
      conformeEn: l.conformeEn,
      diferenciaEnCentavos: l.diferencia === null ? null : texto(l.diferencia),
      explicacion: l.explicacion,
    })),
    origenes: origenes.map((o) => ({ cobranzaId: o.cobranzaId, cobradoEnCentavos: texto(o.cobrado), totalDelTicketEnCentavos: texto(o.totalDelTicket), diferenciaEnCentavos: o.diferencia === null ? null : texto(o.diferencia), explicacion: o.explicacion })),
    controles: j.controles,
  };
}
