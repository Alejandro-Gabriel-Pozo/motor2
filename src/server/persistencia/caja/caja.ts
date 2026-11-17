import "server-only";
import { textoDeCentavos } from "@/core/caja/public";
import type { ClaseDeMovimiento, DatosDelCobroCompletos, DatosQuePideElMedio, TipoDeMedio } from "@/core/caja/public";
import type { Prisma } from "@prisma/client";

/**
 * Persistencia de la CAJA (etapa C1, docs/diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md). Mismo contrato que el resto de `server/persistencia/`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio ni
 * auditoría (las pone el caso de uso dentro de su transacción). La base decide lo que ninguna lectura puede asegurar (ver la migración 20261117110000_caja_c1): una caja por sucursal, una sesión sin cerrar por caja, el signo de cada
 * movimiento, una cobranza por cuenta y que la suma de los renglones dé el total. El dinero entra y sale como CENTAVOS (`bigint`) y se escribe como texto decimal exacto.
 */

/** Un `Decimal` de Prisma (2 decimales) a centavos enteros, sin pasar por `number`. */
export function centavosDeDecimal(d: Prisma.Decimal): bigint {
  return BigInt(d.mul(100).toDecimalPlaces(0).toString());
}

export const SELECCION_DE_SESION = {
  id: true, empresaId: true, sucursalId: true, cajaId: true, estado: true, fechaDeNegocio: true, zonaHoraria: true, abiertaEn: true, abiertaPorId: true, cerradaEn: true, claveIdempotencia: true, huella: true,
} as const satisfies Prisma.SesionCajaSelect;
export type SesionGuardada = Prisma.SesionCajaGetPayload<{ select: typeof SELECCION_DE_SESION }>;

/** La caja de la sucursal (C1: una sola), o `null`. */
export async function cargarCajaDeSucursal(db: Prisma.TransactionClient, empresaId: string, sucursalId: string): Promise<{ id: string } | null> {
  return db.caja.findFirst({ where: { empresaId, sucursalId }, select: { id: true } });
}

/** Crea la caja si todavía no hay (ON CONFLICT DO NOTHING sobre `Caja_una_por_sucursal_key`): dos aperturas a la vez nunca dejan dos cajas. */
export async function asegurarCaja(db: Prisma.TransactionClient, args: { id: string; empresaId: string; sucursalId: string; nombre: string }): Promise<void> {
  await db.caja.createMany({ data: [{ id: args.id, empresaId: args.empresaId, sucursalId: args.sucursalId, nombre: args.nombre }], skipDuplicates: true });
}

/** El medio EFECTIVO de la empresa (uno solo, que no se desactiva), o `null`. */
export async function cargarMedioEfectivo(db: Prisma.TransactionClient, empresaId: string): Promise<{ id: string } | null> {
  return db.medioDePago.findFirst({ where: { empresaId, tipo: "EFECTIVO" }, select: { id: true } });
}

/** Crea el medio EFECTIVO si no hay (ON CONFLICT DO NOTHING sobre `MedioDePago_efectivo_key`). */
export async function asegurarMedioEfectivo(db: Prisma.TransactionClient, args: { id: string; empresaId: string }): Promise<void> {
  await db.medioDePago.createMany({ data: [{ id: args.id, empresaId: args.empresaId, tipo: "EFECTIVO" }], skipDuplicates: true });
}

export async function cargarSesionDeClave(db: Prisma.TransactionClient, empresaId: string, claveIdempotencia: string): Promise<SesionGuardada | null> {
  return db.sesionCaja.findFirst({ where: { empresaId, claveIdempotencia }, select: SELECCION_DE_SESION });
}

/** La sesión sin cerrar de la caja, o `null`. */
export async function cargarSesionAbiertaDeCaja(db: Prisma.TransactionClient, empresaId: string, cajaId: string): Promise<SesionGuardada | null> {
  return db.sesionCaja.findFirst({ where: { empresaId, cajaId, estado: "ABIERTA" }, select: SELECCION_DE_SESION });
}

export async function cargarSesion(db: Prisma.TransactionClient, empresaId: string, id: string): Promise<SesionGuardada | null> {
  return db.sesionCaja.findFirst({ where: { empresaId, id }, select: SELECCION_DE_SESION });
}

export async function insertarSesion(
  db: Prisma.TransactionClient,
  args: { id: string; empresaId: string; sucursalId: string; cajaId: string; fechaDeNegocio: Date; zonaHoraria: string; abiertaEn: Date; abiertaPorId: string; claveIdempotencia: string; huella: string },
): Promise<void> {
  await db.sesionCaja.create({ data: { ...args, estado: "ABIERTA" }, select: { id: true } });
}

/** Cierra la sesión (ABIERTA → CERRADA). Devuelve si escribió: 0 filas = ya estaba cerrada. El disparador de la base deja pasar solo ese cambio. */
export async function cerrarSesionEnBase(db: Prisma.TransactionClient, args: { empresaId: string; id: string; cerradaEn: Date; cerradaPorId: string; observacion: string | null }): Promise<boolean> {
  const { count } = await db.sesionCaja.updateMany({
    where: { empresaId: args.empresaId, id: args.id, estado: "ABIERTA" },
    data: { estado: "CERRADA", cerradaEn: args.cerradaEn, cerradaPorId: args.cerradaPorId, observacion: args.observacion },
  });
  return count > 0;
}

export interface MovimientoGuardado {
  id: string;
  sesionId: string;
  sucursalId: string;
  clase: string;
  medioDePagoId: string;
  importeEnCentavos: bigint;
  motivo: string | null;
  anulaAId: string | null;
  claveIdempotencia: string | null;
  creadoPorId: string;
}

const SELECCION_DE_MOVIMIENTO = { id: true, sesionId: true, sucursalId: true, clase: true, medioDePagoId: true, importe: true, motivo: true, anulaAId: true, claveIdempotencia: true, creadoPorId: true } as const satisfies Prisma.MovimientoCajaSelect;

function aMovimiento(f: Prisma.MovimientoCajaGetPayload<{ select: typeof SELECCION_DE_MOVIMIENTO }>): MovimientoGuardado {
  const { importe, ...resto } = f;
  return { ...resto, importeEnCentavos: centavosDeDecimal(importe) };
}

export async function cargarMovimiento(db: Prisma.TransactionClient, empresaId: string, id: string): Promise<MovimientoGuardado | null> {
  const f = await db.movimientoCaja.findFirst({ where: { empresaId, id }, select: SELECCION_DE_MOVIMIENTO });
  return f ? aMovimiento(f) : null;
}

export async function cargarMovimientoDeClave(db: Prisma.TransactionClient, empresaId: string, claveIdempotencia: string): Promise<MovimientoGuardado | null> {
  const f = await db.movimientoCaja.findFirst({ where: { empresaId, claveIdempotencia }, select: SELECCION_DE_MOVIMIENTO });
  return f ? aMovimiento(f) : null;
}

export async function insertarMovimiento(
  db: Prisma.TransactionClient,
  args: { id: string; empresaId: string; sucursalId: string; sesionId: string; clase: ClaseDeMovimiento; medioDePagoId: string; cuentaDeCobroId?: string | null; importeEnCentavos: bigint; motivo: string | null; anulaAId: string | null; claveIdempotencia: string | null; creadoPorId: string },
): Promise<void> {
  const { importeEnCentavos, ...resto } = args;
  await db.movimientoCaja.create({ data: { ...resto, importe: textoDeCentavos(importeEnCentavos) }, select: { id: true } });
}

/** Lo esperado por (medio, cuenta) en una sesión: Σ de sus movimientos con signo, en centavos. `cuentaDeCobroId: null` = «sin cuenta» (el efectivo siempre). */
export async function sumarMovimientosPorMedioYCuenta(db: Prisma.TransactionClient, empresaId: string, sesionId: string): Promise<readonly { medioDePagoId: string; cuentaDeCobroId: string | null; esperadoEnCentavos: bigint }[]> {
  const grupos = await db.movimientoCaja.groupBy({ by: ["medioDePagoId", "cuentaDeCobroId"], where: { empresaId, sesionId }, _sum: { importe: true } });
  return grupos.map((g) => ({ medioDePagoId: g.medioDePagoId, cuentaDeCobroId: g.cuentaDeCobroId, esperadoEnCentavos: g._sum.importe ? centavosDeDecimal(g._sum.importe) : BigInt(0) }));
}

/** Lo esperado por medio en una sesión (sumando sus cuentas): Σ de sus movimientos con signo, en centavos. */
export async function sumarMovimientosPorMedio(db: Prisma.TransactionClient, empresaId: string, sesionId: string): Promise<ReadonlyMap<string, bigint>> {
  const grupos = await db.movimientoCaja.groupBy({ by: ["medioDePagoId"], where: { empresaId, sesionId }, _sum: { importe: true } });
  return new Map(grupos.map((g) => [g.medioDePagoId, g._sum.importe ? centavosDeDecimal(g._sum.importe) : BigInt(0)]));
}

export interface MedioConDatos {
  tipo: TipoDeMedio;
  activo: boolean;
  /** Qué datos opcionales pide al cobrar (C3). */
  pide: DatosQuePideElMedio;
}

export async function cargarTiposDeMedios(db: Prisma.TransactionClient, empresaId: string, ids: readonly string[]): Promise<ReadonlyMap<string, MedioConDatos>> {
  const filas = await db.medioDePago.findMany({ where: { empresaId, id: { in: [...ids] } }, select: { id: true, tipo: true, activo: true, pideCupon: true, pideUltimos4: true, pideMarca: true, pideCuotas: true, pideDni: true } });
  return new Map(filas.map((f) => [f.id, { tipo: f.tipo as TipoDeMedio, activo: f.activo, pide: { cupon: f.pideCupon, ultimos4: f.pideUltimos4, marca: f.pideMarca, cuotas: f.pideCuotas, dni: f.pideDni } }]));
}

export async function insertarArqueo(
  db: Prisma.TransactionClient,
  args: { id: string; empresaId: string; sucursalId: string; sesionId: string; medioDePagoId: string; cuentaDeCobroId?: string | null; esperadoEnCentavos: bigint; contadoEnCentavos: bigint | null; monedasEnCentavos: bigint | null; conforme: boolean },
): Promise<void> {
  await db.arqueoCaja.create({
    data: {
      id: args.id, empresaId: args.empresaId, sucursalId: args.sucursalId, sesionId: args.sesionId, medioDePagoId: args.medioDePagoId, cuentaDeCobroId: args.cuentaDeCobroId ?? null, conforme: args.conforme,
      esperado: textoDeCentavos(args.esperadoEnCentavos),
      contado: args.contadoEnCentavos === null ? null : textoDeCentavos(args.contadoEnCentavos),
      contadoMonedas: args.monedasEnCentavos === null ? null : textoDeCentavos(args.monedasEnCentavos),
    },
    select: { id: true },
  });
}

export async function insertarBilletes(db: Prisma.TransactionClient, filas: readonly { id: string; empresaId: string; sucursalId: string; sesionId: string; denominacion: number; cantidad: number }[]): Promise<void> {
  if (filas.length === 0) return;
  await db.arqueoBillete.createMany({ data: [...filas] });
}

export interface CobranzaGuardada {
  id: string;
  cuentaId: string;
  sesionId: string;
  totalEnCentavos: bigint;
  claveIdempotencia: string;
  huella: string;
}

export async function cargarCobranzaDeClave(db: Prisma.TransactionClient, empresaId: string, claveIdempotencia: string): Promise<CobranzaGuardada | null> {
  const f = await db.cobranza.findFirst({ where: { empresaId, claveIdempotencia }, select: { id: true, cuentaId: true, sesionId: true, total: true, claveIdempotencia: true, huella: true } });
  return f ? { id: f.id, cuentaId: f.cuentaId, sesionId: f.sesionId, totalEnCentavos: centavosDeDecimal(f.total), claveIdempotencia: f.claveIdempotencia, huella: f.huella } : null;
}

export async function cargarCobranzaDeCuenta(db: Prisma.TransactionClient, empresaId: string, cuentaId: string): Promise<{ id: string } | null> {
  return db.cobranza.findFirst({ where: { empresaId, cuentaId }, select: { id: true } });
}

export async function insertarCobranza(
  db: Prisma.TransactionClient,
  args: { id: string; empresaId: string; sucursalId: string; cuentaId: string; sesionId: string; totalEnCentavos: bigint; claveIdempotencia: string; huella: string; creadoPorId: string },
): Promise<void> {
  const { totalEnCentavos, ...resto } = args;
  await db.cobranza.create({ data: { ...resto, total: textoDeCentavos(totalEnCentavos) }, select: { id: true } });
}

export async function insertarCobro(
  db: Prisma.TransactionClient,
  args: { id: string; empresaId: string; sucursalId: string; cobranzaId: string; orden: number; medioDePagoId: string; cuentaDeCobroId?: string | null; movimientoId: string; importeEnCentavos: bigint; datos?: DatosDelCobroCompletos },
): Promise<void> {
  const { importeEnCentavos, datos, cuentaDeCobroId, ...resto } = args;
  await db.cobro.create({
    data: { ...resto, cuentaDeCobroId: cuentaDeCobroId ?? null, importe: textoDeCentavos(importeEnCentavos), cupon: datos?.cupon ?? null, ultimos4: datos?.ultimos4 ?? null, marcaDeTarjetaId: datos?.marcaDeTarjetaId ?? null, cuotas: datos?.cuotas ?? null, dni: datos?.dni ?? null },
    select: { id: true },
  });
}
