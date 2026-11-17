import "server-only";
import { textoDeCentavos } from "@/core/caja/public";
import type { ControlResuelto } from "@/core/caja/public";
import { diaDeColumnaDate, fechaDeColumnaDate } from "@/core/tiempo/zona-horaria";
import type { Prisma } from "@prisma/client";
import { centavosDeDecimal } from "./caja";

/**
 * Persistencia de la JORNADA de sucursal y de lo que cuelga de ella (etapa C2, docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md). Mismo contrato que `caja.ts`: el cliente es el PRIMER parámetro, `data` literal, sin reglas de negocio ni
 * auditoría (las pone el caso de uso dentro de su transacción). Los BLOQUEOS son parte del contrato (E3b §3.7 de Pedernal): `FOR SHARE` para quien tiene actividad en la jornada y `FOR UPDATE` para quien cambia su estado; se esperan entre sí y,
 * bajo `SERIALIZABLE`, la lectura participa de la verificación de conflictos. La base decide lo que ninguna lectura puede asegurar (ver la migración 20261117114000_caja_c2_jornada).
 */

/** La hora de corte de una columna `TIME(0)` (Prisma la entrega como un `Date` del 1/1/1970 en UTC) a «HH:MM». */
export function horaDeCorteDeColumna(hora: Date): string {
  return `${String(hora.getUTCHours()).padStart(2, "0")}:${String(hora.getUTCMinutes()).padStart(2, "0")}`;
}

export interface JornadaGuardada {
  id: string;
  empresaId: string;
  sucursalId: string;
  /** «AAAA-MM-DD». */
  fechaDeNegocio: string;
  estado: string;
  auditoriaIniciadaEn: Date | null;
  cerradaEn: Date | null;
  huellaDeCierre: string | null;
  observacion: string | null;
}

interface FilaCruda {
  id: string;
  empresaId: string;
  sucursalId: string;
  fechaDeNegocio: Date;
  estado: string;
  auditoriaIniciadaEn: Date | null;
  cerradaEn: Date | null;
  huellaDeCierre: string | null;
  observacion: string | null;
}

function aJornada(f: FilaCruda): JornadaGuardada {
  return { ...f, fechaDeNegocio: diaDeColumnaDate(f.fechaDeNegocio) };
}

type Bloqueo = "COMPARTIDO" | "PARA_CAMBIAR";

async function leerBloqueando(db: Prisma.TransactionClient, empresaId: string, sucursalId: string, fecha: string, bloqueo: Bloqueo): Promise<JornadaGuardada | null> {
  const dia = fechaDeColumnaDate(fecha);
  const filas =
    bloqueo === "COMPARTIDO"
      ? await db.$queryRaw<FilaCruda[]>`SELECT "id", "empresaId", "sucursalId", "fechaDeNegocio", "estado", "auditoriaIniciadaEn", "cerradaEn", "huellaDeCierre", "observacion" FROM "JornadaDeSucursal" WHERE "empresaId" = ${empresaId} AND "sucursalId" = ${sucursalId} AND "fechaDeNegocio" = ${dia}::date FOR SHARE`
      : await db.$queryRaw<FilaCruda[]>`SELECT "id", "empresaId", "sucursalId", "fechaDeNegocio", "estado", "auditoriaIniciadaEn", "cerradaEn", "huellaDeCierre", "observacion" FROM "JornadaDeSucursal" WHERE "empresaId" = ${empresaId} AND "sucursalId" = ${sucursalId} AND "fechaDeNegocio" = ${dia}::date FOR UPDATE`;
  const fila = filas[0];
  return fila === undefined ? null : aJornada(fila);
}

/**
 * La jornada, creándola si todavía no existe (`INSERT … ON CONFLICT DO NOTHING` sobre `JornadaDeSucursal_una_por_dia_key`), leída con `FOR SHARE`: mientras esta transacción no termine, nadie puede pasarla de estado (iniciar el cierre espera, o la
 * serializable repite). Quien la llama decide con el estado que lee. Es la forma de «nace con la primera actividad del día».
 */
export async function asegurarYBloquearJornadaCompartida(db: Prisma.TransactionClient, args: { id: string; empresaId: string; sucursalId: string; fechaDeNegocio: string }): Promise<JornadaGuardada> {
  await db.jornadaDeSucursal.createMany({ data: [{ id: args.id, empresaId: args.empresaId, sucursalId: args.sucursalId, fechaDeNegocio: fechaDeColumnaDate(args.fechaDeNegocio) }], skipDuplicates: true });
  const jornada = await leerBloqueando(db, args.empresaId, args.sucursalId, args.fechaDeNegocio, "COMPARTIDO");
  // Recién creada o ya existente, la fila tiene que verse: si no, una política de la base la ocultó.
  if (jornada === null) throw new Error("la jornada asegurada no es visible para el contexto");
  return jornada;
}

/** La jornada leída con `FOR SHARE`; `null` si no existe o no es de la empresa. */
export function bloquearJornadaCompartida(db: Prisma.TransactionClient, empresaId: string, sucursalId: string, fecha: string): Promise<JornadaGuardada | null> {
  return leerBloqueando(db, empresaId, sucursalId, fecha, "COMPARTIDO");
}

/** La jornada leída con `FOR UPDATE`: quien inicia, cancela o cierra se serializa con todos los demás. `null` si no existe. */
export function bloquearJornadaParaCambiar(db: Prisma.TransactionClient, empresaId: string, sucursalId: string, fecha: string): Promise<JornadaGuardada | null> {
  return leerBloqueando(db, empresaId, sucursalId, fecha, "PARA_CAMBIAR");
}

/** Lectura simple (sin bloqueo). */
export async function cargarJornada(db: Prisma.TransactionClient, empresaId: string, sucursalId: string, fecha: string): Promise<JornadaGuardada | null> {
  const f = await db.jornadaDeSucursal.findFirst({
    where: { empresaId, sucursalId, fechaDeNegocio: fechaDeColumnaDate(fecha) },
    select: { id: true, empresaId: true, sucursalId: true, fechaDeNegocio: true, estado: true, auditoriaIniciadaEn: true, cerradaEn: true, huellaDeCierre: true, observacion: true },
  });
  return f === null ? null : aJornada(f);
}

/** `ABIERTA → EN_AUDITORIA`. La jornada tiene que estar tomada con `FOR UPDATE`; si no cambia exactamente una fila, lanza. */
export async function iniciarAuditoriaEnBase(db: Prisma.TransactionClient, args: { empresaId: string; id: string; iniciadaEn: Date; iniciadaPorId: string }): Promise<void> {
  const { count } = await db.jornadaDeSucursal.updateMany({ where: { empresaId: args.empresaId, id: args.id, estado: "ABIERTA" }, data: { estado: "EN_AUDITORIA", auditoriaIniciadaEn: args.iniciadaEn, auditoriaIniciadaPorId: args.iniciadaPorId } });
  if (count !== 1) throw new Error("iniciarAuditoria: la jornada no cambió exactamente una fila");
}

/** `EN_AUDITORIA → ABIERTA` (borra las marcas de la auditoría; el rastro queda en la auditoría administrativa). Mismo contrato. */
export async function cancelarAuditoriaEnBase(db: Prisma.TransactionClient, args: { empresaId: string; id: string }): Promise<void> {
  const { count } = await db.jornadaDeSucursal.updateMany({ where: { empresaId: args.empresaId, id: args.id, estado: "EN_AUDITORIA" }, data: { estado: "ABIERTA", auditoriaIniciadaEn: null, auditoriaIniciadaPorId: null } });
  if (count !== 1) throw new Error("cancelarAuditoria: la jornada no cambió exactamente una fila");
}

/** `EN_AUDITORIA → CERRADA`. Mismo contrato. */
export async function cerrarJornadaEnBase(db: Prisma.TransactionClient, args: { empresaId: string; id: string; cerradaEn: Date; cerradaPorId: string; huella: string; observacion: string | null }): Promise<void> {
  const { count } = await db.jornadaDeSucursal.updateMany({
    where: { empresaId: args.empresaId, id: args.id, estado: "EN_AUDITORIA" },
    data: { estado: "CERRADA", cerradaEn: args.cerradaEn, cerradaPorId: args.cerradaPorId, huellaDeCierre: args.huella, observacion: args.observacion },
  });
  if (count !== 1) throw new Error("cerrarJornada: la jornada no cambió exactamente una fila");
}

export interface ControlGuardado {
  clave: string;
  severidad: string;
  cantidad: number;
  reconocido: boolean;
  texto: string | null;
}

/** La foto de controles de una jornada cerrada. */
export async function cargarControlesGuardados(db: Prisma.TransactionClient, empresaId: string, jornadaId: string): Promise<ControlGuardado[]> {
  return db.controlDeJornadaCerrada.findMany({ where: { empresaId, jornadaId }, orderBy: { clave: "asc" }, select: { clave: true, severidad: true, cantidad: true, reconocido: true, texto: true } });
}

/**
 * Guarda la foto de controles (solo inserción), DESPUÉS de pasar la jornada a `CERRADA` en la misma transacción: la base lo exige. `reconocidoPorId` es quien cierra y `reconocidoEn` el `ahora`, para los controles reconocidos.
 */
export async function insertarControles(
  db: Prisma.TransactionClient,
  args: { empresaId: string; sucursalId: string; jornadaId: string; controles: readonly ControlResuelto[]; ids: readonly string[]; reconocePorId: string; ahora: Date },
): Promise<void> {
  await db.controlDeJornadaCerrada.createMany({
    data: args.controles.map((c, i) => ({
      id: args.ids[i] as string,
      empresaId: args.empresaId,
      sucursalId: args.sucursalId,
      jornadaId: args.jornadaId,
      modulo: c.modulo,
      clave: c.clave,
      severidad: c.severidad,
      cantidad: c.cantidad,
      reconocido: c.reconocido,
      reconocidoEn: c.reconocido ? args.ahora : null,
      reconocidoPorId: c.reconocido ? args.reconocePorId : null,
      texto: c.texto,
    })),
  });
}

/** La cabecera de la foto de la conciliación (C2b): solo con la jornada pasando a CERRADA en esta misma transacción (la base lo exige). */
export async function insertarCierreDeCaja(db: Prisma.TransactionClient, args: { id: string; empresaId: string; sucursalId: string; jornadaId: string; congeladoEn: Date; congeladoPorId: string }): Promise<void> {
  await db.cierreDeCajaDeJornada.create({ data: args, select: { id: true } });
}

export interface LineaDeFoto {
  id: string;
  medioDePagoId: string;
  registradoEnCentavos: bigint;
  correccionesEnCentavos: bigint;
  declaradoEnCentavos: bigint | null;
  estadoDeConteo: string;
  conformePorId: string | null;
  conformeEn: Date | null;
  explicacion: string | null;
}

/** Una línea por medio de la foto de la conciliación. La `diferencia` la calcula la base (columna generada): acá no se escribe. */
export async function insertarLineasDeConciliacion(db: Prisma.TransactionClient, args: { empresaId: string; sucursalId: string; cierreId: string; lineas: readonly LineaDeFoto[] }): Promise<void> {
  if (args.lineas.length === 0) return;
  await db.conciliacionDeJornada.createMany({
    data: args.lineas.map((l) => ({
      id: l.id,
      empresaId: args.empresaId,
      sucursalId: args.sucursalId,
      cierreId: args.cierreId,
      medioDePagoId: l.medioDePagoId,
      registrado: textoDeCentavos(l.registradoEnCentavos),
      correcciones: textoDeCentavos(l.correccionesEnCentavos),
      declarado: l.declaradoEnCentavos === null ? null : textoDeCentavos(l.declaradoEnCentavos),
      estadoDeConteo: l.estadoDeConteo,
      conformePorId: l.conformePorId,
      conformeEn: l.conformeEn,
      explicacion: l.explicacion,
    })),
  });
}

export interface OrigenDeFoto {
  id: string;
  cobranzaId: string;
  cobradoEnCentavos: bigint;
  totalDelTicketEnCentavos: bigint;
  explicacion: string | null;
}

/** Los orígenes (cobranzas) cuyo cobrado difiere del total vigente de su ticket. La `diferencia` la calcula la base. */
export async function insertarOrigenesDeConciliacion(db: Prisma.TransactionClient, args: { empresaId: string; sucursalId: string; cierreId: string; origenes: readonly OrigenDeFoto[] }): Promise<void> {
  if (args.origenes.length === 0) return;
  await db.conciliacionDeCobroPorOrigen.createMany({
    data: args.origenes.map((o) => ({ id: o.id, empresaId: args.empresaId, sucursalId: args.sucursalId, cierreId: args.cierreId, cobranzaId: o.cobranzaId, cobrado: textoDeCentavos(o.cobradoEnCentavos), totalDelTicket: textoDeCentavos(o.totalDelTicketEnCentavos), explicacion: o.explicacion })),
  });
}

export interface CobroParaCorregir {
  cobroId: string;
  sucursalId: string;
  medioDePagoId: string;
  importeEnCentavos: bigint;
  /** La fecha de negocio de la sesión del cobro («AAAA-MM-DD»): la jornada a la que pertenece. */
  fechaDeNegocio: string;
  correcciones: { secuencia: number; medioDespuesId: string }[];
}

/** El cobro (renglón) con la fecha de su sesión y sus correcciones; `null` si no existe en la empresa. */
export async function cargarCobroParaCorregir(db: Prisma.TransactionClient, empresaId: string, cobroId: string): Promise<CobroParaCorregir | null> {
  const f = await db.cobro.findFirst({
    where: { empresaId, id: cobroId },
    select: { id: true, sucursalId: true, medioDePagoId: true, importe: true, cobranza: { select: { sesion: { select: { fechaDeNegocio: true } } } }, correcciones: { select: { secuencia: true, medioDespuesId: true } } },
  });
  if (f === null) return null;
  return { cobroId: f.id, sucursalId: f.sucursalId, medioDePagoId: f.medioDePagoId, importeEnCentavos: centavosDeDecimal(f.importe), fechaDeNegocio: diaDeColumnaDate(f.cobranza.sesion.fechaDeNegocio), correcciones: f.correcciones };
}

export interface CorreccionGuardada {
  id: string;
  cobroId: string;
  secuencia: number;
  huella: string;
}

export async function cargarCorreccionDeClave(db: Prisma.TransactionClient, empresaId: string, claveIdempotencia: string): Promise<CorreccionGuardada | null> {
  return db.correccionDeMedio.findFirst({ where: { empresaId, claveIdempotencia }, select: { id: true, cobroId: true, secuencia: true, huella: true } });
}

export async function insertarCorreccion(
  db: Prisma.TransactionClient,
  args: { id: string; empresaId: string; sucursalId: string; jornadaId: string; cobroId: string; secuencia: number; medioAntesId: string; medioDespuesId: string; motivo: string; corregidoEn: Date; corregidoPorId: string; claveIdempotencia: string; huella: string },
): Promise<void> {
  await db.correccionDeMedio.create({ data: args, select: { id: true } });
}

export interface DeclaracionGuardada {
  id: string;
  secuencia: number;
  huella: string;
}

export async function cargarDeclaracionDeClave(db: Prisma.TransactionClient, empresaId: string, claveIdempotencia: string): Promise<DeclaracionGuardada | null> {
  return db.declaracionDeTotal.findFirst({ where: { empresaId, claveIdempotencia }, select: { id: true, secuencia: true, huella: true } });
}

export async function cargarSecuenciasDelMedio(db: Prisma.TransactionClient, empresaId: string, jornadaId: string, medioDePagoId: string): Promise<number[]> {
  const filas = await db.declaracionDeTotal.findMany({ where: { empresaId, jornadaId, medioDePagoId }, select: { secuencia: true } });
  return filas.map((f) => f.secuencia);
}

export async function insertarDeclaracion(
  db: Prisma.TransactionClient,
  args: { id: string; empresaId: string; sucursalId: string; jornadaId: string; medioDePagoId: string; secuencia: number; importeEnCentavos: bigint; declaradoEn: Date; declaradoPorId: string; claveIdempotencia: string; huella: string },
): Promise<void> {
  const { importeEnCentavos, ...resto } = args;
  await db.declaracionDeTotal.create({ data: { ...resto, importe: textoDeCentavos(importeEnCentavos) }, select: { id: true } });
}

export async function cargarConformeDeClave(db: Prisma.TransactionClient, empresaId: string, claveIdempotencia: string): Promise<{ id: string; huella: string } | null> {
  return db.conformeDeJornada.findFirst({ where: { empresaId, claveIdempotencia }, select: { id: true, huella: true } });
}

export async function cargarConformeDeJornada(db: Prisma.TransactionClient, empresaId: string, jornadaId: string): Promise<{ id: string } | null> {
  return db.conformeDeJornada.findFirst({ where: { empresaId, jornadaId }, select: { id: true } });
}

export async function insertarConforme(db: Prisma.TransactionClient, args: { id: string; empresaId: string; sucursalId: string; jornadaId: string; conformePorId: string; conformeEn: Date; claveIdempotencia: string; huella: string }): Promise<void> {
  await db.conformeDeJornada.create({ data: args, select: { id: true } });
}
