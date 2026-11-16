import "server-only";
import type { CierreDeCajaDelMedio } from "@/core/caja/public";
import { fechaDeNegocio } from "@/core/caja/public";
import { diaDeColumnaDate, fechaDeColumnaDate, sumarDias, inicioDelDia } from "@/core/tiempo/zona-horaria";
import type { Prisma } from "@prisma/client";
import { centavosDeDecimal } from "./caja";

/**
 * Lecturas de la jornada para sus controles y su conciliación (etapa C2, docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md): todo lo que el día necesita, leído en la transacción de quien llama, SIN reglas de negocio (las del cálculo son de
 * `src/core/caja/`) y sin reloj ni azar. Las sesiones de una jornada son las que sellaron esa fecha de negocio en esa sucursal.
 */

export interface SesionDeLaJornada {
  id: string;
  estado: string;
}

export async function cargarSesionesDeLaJornada(db: Prisma.TransactionClient, empresaId: string, sucursalId: string, fecha: string): Promise<SesionDeLaJornada[]> {
  return db.sesionCaja.findMany({ where: { empresaId, sucursalId, fechaDeNegocio: fechaDeColumnaDate(fecha) }, orderBy: { abiertaEn: "asc" }, select: { id: true, estado: true } });
}

/** Contado − esperado del efectivo de cada sesión cerrada de la lista (una entrada por sesión con arqueo de efectivo). */
export async function cargarDiferenciasDeEfectivo(db: Prisma.TransactionClient, empresaId: string, sesionIds: readonly string[]): Promise<ReadonlyMap<string, bigint>> {
  const filas = await db.arqueoCaja.findMany({ where: { empresaId, sesionId: { in: [...sesionIds] }, conforme: false, medioDePago: { tipo: "EFECTIVO" } }, select: { sesionId: true, esperado: true, contado: true } });
  const diferencias = new Map<string, bigint>();
  for (const f of filas) if (f.contado !== null) diferencias.set(f.sesionId, centavosDeDecimal(f.contado) - centavosDeDecimal(f.esperado));
  return diferencias;
}

/** Lo registrado por medio en las sesiones de la lista: Σ de sus movimientos con signo. */
export async function cargarRegistradoPorMedio(db: Prisma.TransactionClient, empresaId: string, sesionIds: readonly string[]): Promise<{ medioDePagoId: string; importeEnCentavos: bigint }[]> {
  const grupos = await db.movimientoCaja.groupBy({ by: ["medioDePagoId"], where: { empresaId, sesionId: { in: [...sesionIds] } }, _sum: { importe: true } });
  return grupos.map((g) => ({ medioDePagoId: g.medioDePagoId, importeEnCentavos: g._sum.importe ? centavosDeDecimal(g._sum.importe) : BigInt(0) }));
}

/** Las líneas de arqueo de las sesiones de la lista, como las ve la conciliación (el conforme lo da quien cerró la sesión, cuando la cerró). Una línea contada sin importe, o conforme de una sesión sin cierre, rompe una invariante de la base. */
export async function cargarCierresDeCaja(db: Prisma.TransactionClient, empresaId: string, sesionIds: readonly string[]): Promise<CierreDeCajaDelMedio[]> {
  const filas = await db.arqueoCaja.findMany({ where: { empresaId, sesionId: { in: [...sesionIds] } }, select: { medioDePagoId: true, conforme: true, contado: true, sesion: { select: { cerradaPorId: true, cerradaEn: true } } } });
  return filas.map((f): CierreDeCajaDelMedio => {
    if (f.conforme) {
      if (f.sesion.cerradaPorId === null || f.sesion.cerradaEn === null) throw new Error("invariante rota: un arqueo conforme de una sesión sin cerrar");
      return { medioDePagoId: f.medioDePagoId, conforme: true, conformePorId: f.sesion.cerradaPorId, conformeEn: f.sesion.cerradaEn };
    }
    if (f.contado === null) throw new Error("invariante rota: un arqueo sin conforme y sin contado");
    return { medioDePagoId: f.medioDePagoId, conforme: false, contadoEnCentavos: centavosDeDecimal(f.contado) };
  });
}

export async function cargarMedioEfectivoId(db: Prisma.TransactionClient, empresaId: string): Promise<string | null> {
  const m = await db.medioDePago.findFirst({ where: { empresaId, tipo: "EFECTIVO" }, select: { id: true } });
  return m?.id ?? null;
}

/** Las correcciones de medio de la jornada, con el importe del cobro que corrigen. */
export async function cargarCorreccionesDeLaJornada(db: Prisma.TransactionClient, empresaId: string, jornadaId: string): Promise<{ id: string; cobroId: string; secuencia: number; importeEnCentavos: bigint; medioAntesId: string; medioDespuesId: string }[]> {
  const filas = await db.correccionDeMedio.findMany({ where: { empresaId, jornadaId }, select: { id: true, cobroId: true, secuencia: true, medioAntesId: true, medioDespuesId: true, cobro: { select: { importe: true } } } });
  return filas.map((f) => ({ id: f.id, cobroId: f.cobroId, secuencia: f.secuencia, medioAntesId: f.medioAntesId, medioDespuesId: f.medioDespuesId, importeEnCentavos: centavosDeDecimal(f.cobro.importe) }));
}

export async function cargarDeclaracionesDeLaJornada(db: Prisma.TransactionClient, empresaId: string, jornadaId: string): Promise<{ medioDePagoId: string; secuencia: number; importeEnCentavos: bigint }[]> {
  const filas = await db.declaracionDeTotal.findMany({ where: { empresaId, jornadaId }, select: { medioDePagoId: true, secuencia: true, importe: true } });
  return filas.map((f) => ({ medioDePagoId: f.medioDePagoId, secuencia: f.secuencia, importeEnCentavos: centavosDeDecimal(f.importe) }));
}

export async function cargarConformeGeneral(db: Prisma.TransactionClient, empresaId: string, jornadaId: string): Promise<{ porId: string; en: Date } | null> {
  const f = await db.conformeDeJornada.findFirst({ where: { empresaId, jornadaId }, select: { conformePorId: true, conformeEn: true } });
  return f === null ? null : { porId: f.conformePorId, en: f.conformeEn };
}

/** Los ajustes registrados en las sesiones de la jornada que explican una jornada ya cerrada. */
export async function cargarAjustesQueCorrigen(db: Prisma.TransactionClient, empresaId: string, sesionIds: readonly string[]): Promise<{ id: string; corrigeJornada: string; importeEnCentavos: bigint; medioDePagoId: string }[]> {
  const filas = await db.movimientoCaja.findMany({ where: { empresaId, sesionId: { in: [...sesionIds] }, clase: "AJUSTE", corrigeJornada: { not: null } }, select: { id: true, corrigeJornada: true, importe: true, medioDePagoId: true } });
  return filas.map((f) => ({ id: f.id, corrigeJornada: diaDeColumnaDate(f.corrigeJornada as Date), importeEnCentavos: centavosDeDecimal(f.importe), medioDePagoId: f.medioDePagoId }));
}

/** Las cobranzas de las sesiones de la lista (lo cobrado, congelado al cobrar). */
export async function cargarCobranzasDeLasSesiones(db: Prisma.TransactionClient, empresaId: string, sesionIds: readonly string[]): Promise<{ cobranzaId: string; cuentaId: string; totalEnCentavos: bigint }[]> {
  const filas = await db.cobranza.findMany({ where: { empresaId, sesionId: { in: [...sesionIds] } }, select: { id: true, cuentaId: true, total: true } });
  return filas.map((f) => ({ cobranzaId: f.id, cuentaId: f.cuentaId, totalEnCentavos: centavosDeDecimal(f.total) }));
}

/** Las cuentas ABIERTAS de la sucursal (de cualquier día: una cuenta abierta impide contar el día). */
export async function cargarCuentasAbiertas(db: Prisma.TransactionClient, empresaId: string, sucursalId: string): Promise<string[]> {
  const filas = await db.cuenta.findMany({ where: { empresaId, cerradaEn: null, mesa: { sucursalId } }, select: { id: true } });
  return filas.map((f) => f.id);
}

/**
 * Las cuentas cerradas CON venta (tienen ejemplar de ticket) y SIN cobro cuya fecha de negocio es la de la jornada: la fecha sale de la hora de cierre con la zona de la empresa y la hora de corte VIGENTE de la sucursal (la cuenta no sella
 * fecha de negocio). Se acota por un rango de instantes holgado y se filtra con la fórmula exacta.
 */
export async function cargarCuentasPorCobrar(db: Prisma.TransactionClient, args: { empresaId: string; sucursalId: string; fecha: string; zonaHoraria: string; horaDeCorte: string }): Promise<string[]> {
  const desde = inicioDelDia(sumarDias(args.fecha, -2), args.zonaHoraria);
  const hasta = inicioDelDia(sumarDias(args.fecha, 3), args.zonaHoraria);
  const filas = await db.cuenta.findMany({
    where: { empresaId: args.empresaId, cerradaEn: { gte: desde, lt: hasta }, mesa: { sucursalId: args.sucursalId }, ejemplaresTicket: { some: {} }, cobranza: { is: null } },
    select: { id: true, cerradaEn: true },
  });
  return filas.filter((f) => {
    const dia = fechaDeNegocio(f.cerradaEn as Date, args.zonaHoraria, args.horaDeCorte);
    return dia.ok && dia.valor === args.fecha;
  }).map((f) => f.id);
}
