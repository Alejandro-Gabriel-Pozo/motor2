"use server";

import { esDiaISOReal } from "@/core/tiempo/zona-horaria";
import { consultarConciliacionDeJornada, type ConciliacionDeJornada } from "@/server/lecturas/caja/conciliacion-de-jornada";
import { consultarEstadoDeJornada, listarJornadas, type EstadoDeJornada, type PaginaDeJornadas } from "@/server/lecturas/caja/jornadas-de-sucursal";
import { requerirVer } from "../con-sesion";
import { leerControlesDeLaJornada } from "./casos-de-uso/controles-de-la-jornada";

/**
 * Las LECTURAS del cierre del día (caja, etapa A, 2026-11-17; docs/diseno-caja-cierre-del-dia-acciones-y-permisos-2026-11-17.md §5): cada una pide `caja_jornada_ver` en la sucursal ACTIVA como primera línea (`requerirVer`) y usa la sucursal y la
 * empresa del CONTEXTO (nunca una que mande el navegador). Devuelven solo datos de lectura: importes en CENTAVOS como texto, sin datos personales. La fecha de negocio se valida por lista de permitidos (`AAAA-MM-DD` de un día real) antes de leer
 * nada; un dato que no vale lanza, como el rechazo de permiso (la pantalla refresca). El reloj se lee acá, en el borde.
 */

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MENSAJE_FECHA = "La fecha del día de negocio no es válida.";

/** El estado de la jornada de la sucursal activa en esa fecha de negocio, o `null` si ese día todavía no tuvo actividad. */
export async function leerEstadoDeJornada(fechaDeNegocio: string): Promise<EstadoDeJornada | null> {
  const ctx = await requerirVer("caja_jornada_ver");
  if (!esDiaISOReal(fechaDeNegocio)) throw new Error(MENSAJE_FECHA);
  return consultarEstadoDeJornada(ctx.sucursalId, fechaDeNegocio, ctx.db);
}

/** Un control del día tal como lo ve quien cierra: su severidad, la cantidad de hallazgos, el detalle y las referencias para navegar. */
export interface ControlDeLaJornadaLeido {
  modulo: string;
  clave: string;
  severidad: "BLOQUEA" | "RECONOCIBLE" | "INFORMA";
  cantidad: number;
  detalle: readonly (readonly (string | number | null)[])[];
  referencias: readonly string[];
}

export interface LineaDeConciliacionVista {
  medioDePagoId: string;
  tipoDeMedio: string;
  nombreDelMedio: string | null;
  registradoEnCentavos: string;
  correccionesEnCentavos: string;
  declaradoEnCentavos: string | null;
  estadoDeConteo: string;
  conformePorId: string | null;
  conformeEn: Date | null;
  diferenciaEnCentavos: string | null;
}

export interface ControlesDeLaJornadaLeidos {
  fechaDeNegocio: string;
  /** El estado de la jornada, o `null` si ese día todavía no tuvo actividad. */
  estadoDeLaJornada: string | null;
  controles: readonly ControlDeLaJornadaLeido[];
  /** La conciliación por medio calculada ahora (la que se congela al cerrar). */
  conciliacion: readonly LineaDeConciliacionVista[];
  /** Las cobranzas cuyo cobrado difiere del total vigente de su ticket. */
  origenesConDiferencia: readonly { cobranzaId: string; cobradoEnCentavos: string; totalDelTicketEnCentavos: string }[];
  /** La huella de estos controles: la pantalla la manda de vuelta al cerrar (`huellaVista`). */
  huella: string;
}

/** Los controles de la jornada de la sucursal activa calculados AHORA, con su huella y la conciliación por medio. Es lo que la pantalla muestra y lo que `cerrarJornadaDeCaja` vuelve a calcular y compara. */
export async function leerControlesDeJornada(fechaDeNegocio: string): Promise<ControlesDeLaJornadaLeidos> {
  const ctx = await requerirVer("caja_jornada_ver");
  if (!esDiaISOReal(fechaDeNegocio)) throw new Error(MENSAJE_FECHA);
  const ahora = new Date();
  return ctx.transaccion(async (tx) => {
    const estado = await consultarEstadoDeJornada(ctx.sucursalId, fechaDeNegocio, tx);
    const r = await leerControlesDeLaJornada(tx, { empresaId: ctx.empresaId, sucursalId: ctx.sucursalId, fechaDeNegocio, jornadaId: estado?.jornadaId ?? null, zonaHoraria: ctx.empresaZonaHoraria, ahora });
    const medios = new Map((await tx.medioDePago.findMany({ where: { id: { in: r.conciliacion.map((l) => l.medioDePagoId) } }, select: { id: true, tipo: true, nombre: true } })).map((m) => [m.id, m]));
    return {
      fechaDeNegocio,
      estadoDeLaJornada: estado?.estado ?? null,
      controles: r.controles.map((c) => ({ modulo: c.modulo, clave: c.clave, severidad: c.severidad, cantidad: c.cantidad, detalle: c.detalle, referencias: c.referencias })),
      conciliacion: r.conciliacion.map((l) => ({
        medioDePagoId: l.medioDePagoId,
        tipoDeMedio: medios.get(l.medioDePagoId)?.tipo ?? "",
        nombreDelMedio: medios.get(l.medioDePagoId)?.nombre ?? null,
        registradoEnCentavos: l.registradoEnCentavos.toString(),
        correccionesEnCentavos: l.correccionesEnCentavos.toString(),
        declaradoEnCentavos: l.declaradoEnCentavos === null ? null : l.declaradoEnCentavos.toString(),
        estadoDeConteo: l.estado,
        conformePorId: l.conformePorId,
        conformeEn: l.conformeEn,
        diferenciaEnCentavos: l.diferenciaEnCentavos === null ? null : l.diferenciaEnCentavos.toString(),
      })),
      origenesConDiferencia: r.origenesConDiferencia.map((o) => ({ cobranzaId: o.cobranzaId, cobradoEnCentavos: o.cobradoEnCentavos.toString(), totalDelTicketEnCentavos: o.totalDelTicketEnCentavos.toString() })),
      huella: r.huella,
    };
  });
}

/** Las jornadas de la sucursal activa, la más reciente primero, de a una página; `cursor` es el `nextCursor` de la página anterior (un cursor que no es un id devuelve una página vacía). */
export async function leerJornadasDeCaja(cursor?: string): Promise<PaginaDeJornadas> {
  const ctx = await requerirVer("caja_jornada_ver");
  if (typeof cursor === "string" && cursor !== "" && !REGEX_UUID.test(cursor)) return { items: [], nextCursor: null };
  return listarJornadas({ sucursalId: ctx.sucursalId, ...(typeof cursor === "string" && cursor !== "" ? { cursor } : {}) }, ctx.db);
}

/** La conciliación CONGELADA de una jornada cerrada de la sucursal activa (la foto que guardó el cierre), o `null` si el día no existe o todavía no se cerró. */
export async function leerConciliacionDeJornada(fechaDeNegocio: string): Promise<ConciliacionDeJornada | null> {
  const ctx = await requerirVer("caja_jornada_ver");
  if (!esDiaISOReal(fechaDeNegocio)) throw new Error(MENSAJE_FECHA);
  return consultarConciliacionDeJornada(ctx.sucursalId, fechaDeNegocio, ctx.db);
}
