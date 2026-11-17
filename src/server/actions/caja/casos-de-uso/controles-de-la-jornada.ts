import "server-only";
import { centavosDeImporte, conciliarJornada, controlesDelDia, ordenarControles } from "@/core/caja/public";
import type { ControlDelDia, DatosParaLosControles, LineaDeConciliacion } from "@/core/caja/public";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  cargarAjustesQueCorrigen,
  cargarCierresDeCaja,
  cargarCobranzasDeLasSesiones,
  cargarConformeGeneral,
  cargarCorreccionesDeLaJornada,
  cargarCuentasAbiertas,
  cargarCuentasPorCobrar,
  cargarDeclaracionesDeLaJornada,
  cargarDiferenciasDeEfectivo,
  cargarMedioEfectivoId,
  cargarRegistradoPorMedio,
  cargarSesionesDeLaJornada,
} from "@/server/persistencia/caja/jornada-lecturas";
import { horaDeCorteDeColumna } from "@/server/persistencia/caja/jornada";
import { cargarCuentaParaCobrar } from "@/server/lecturas/caja/total-de-cuenta";

/**
 * Los controles de una jornada y su HUELLA (etapa C2, docs/diseno-caja-c2-jornada-y-cierre-del-dia-2026-11-16.md, niveles 5 y 9). Helper COMPARTIDO por los casos de uso del cierre y la lectura de la pantalla (`leerControlesDeJornada`, `actions/caja/lecturas-del-cierre.ts`; vive en `casos-de-uso/` porque la capa de persistencia solo la usan los casos de uso del dominio); es la lectura que usan la pantalla del cierre que mostrará los controles y pedirá cerrar con su huella y `cerrarJornada` (que
 * los recalcula dentro de su transacción y compara): si cada uno los calculara por su lado, lo que se muestra y lo que se cierra podrían diferir. Todo el cálculo es de `src/core/caja/` (`conciliarJornada`, `controlesDelDia`); acá solo se lee y se junta.
 * Determinista: con los mismos datos, la misma huella (sin reloj ni azar: `ahora` solo entra al recalcular el total vigente del ticket, que no depende de él).
 *
 * El total vigente de cada ticket cobrado se recalcula con `cargarCuentaParaCobrar` (el mismo cálculo del ticket «como se imprimiría ahora»): un ticket que se corrigió o se anuló después de cobrarlo difiere de lo cobrado y aparece en
 * `caja.cobrado_contra_ticket` (decisión del dueño, 2026-11-16: anular un ticket entero ya cobrado deja la plata como diferencia que se explica al cerrar el día; no sale sola de la caja).
 */
export interface ControlesDeLaJornada {
  controles: readonly ControlDelDia[];
  /** La conciliación por medio de la jornada (la que se congela al cerrar, C2b). */
  conciliacion: readonly LineaDeConciliacion[];
  /** Las cobranzas del día cuyo cobrado difiere del total vigente de su ticket (las que se congelan al cerrar, C2b). */
  origenesConDiferencia: readonly { cobranzaId: string; cobradoEnCentavos: bigint; totalDelTicketEnCentavos: bigint }[];
  /** sha256 (hex) de la lista ordenada `(clave, severidad, cantidad, detalle)` de los controles: lo que la pantalla vio y lo que `cerrarJornada` vuelve a calcular. */
  huella: string;
}

/**
 * Calcula los controles de la jornada, su conciliación por medio y su huella, dentro de la transacción (o con el cliente) que recibe; no escribe nada. La llaman `iniciarAuditoria` y `cerrarJornada` y la lectura `leerControlesDeJornada` (`actions/caja/lecturas-del-cierre.ts`, que ya pidió `caja_jornada_ver` con `requerirVer`).
 *
 * @contract Devuelve los controles, la conciliación y la huella de la jornada con los datos que ve, sin escribir; con el mismo estado de la base devuelve la misma huella.
 * @idempotency No aplica: solo lee, repetirla no cambia nada.
 * @transaction Ninguna propia: usa el cliente (o la transacción) de quien la llama, que decide el aislamiento.
 * @sideEffects Ninguno: no escribe ni audita.
 * @ficha permiso=SIN_PERMISO transaccion=NINGUNA idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function leerControlesDeLaJornada(
  db: Prisma.TransactionClient,
  args: { empresaId: string; sucursalId: string; fechaDeNegocio: string; /** La jornada si ya existe (`null` = sin actividad: no hay correcciones, declaraciones ni conforme). */ jornadaId: string | null; zonaHoraria: string; ahora: Date; /** Solo lo que IMPIDE contar el día (los controles `BLOQUEA`): el resto va vacío y no se lee (más barato; la huella NO es la del cierre). */ soloImpedimentos?: boolean },
): Promise<ControlesDeLaJornada> {
  const { empresaId, sucursalId, fechaDeNegocio, jornadaId } = args;
  const sucursal = await db.sucursal.findFirst({ where: { empresaId, id: sucursalId }, select: { horaDeCorte: true } });
  if (sucursal === null) throw new Error("leerControlesDeLaJornada: la sucursal no existe");
  const sesiones = await cargarSesionesDeLaJornada(db, empresaId, sucursalId, fechaDeNegocio);
  const sesionIds = sesiones.map((s) => s.id);
  const diferencias = await cargarDiferenciasDeEfectivo(db, empresaId, sesionIds);
  const efectivoId = await cargarMedioEfectivoId(db, empresaId);
  // Una sesión siempre nace con su fondo en efectivo: sin el medio no hay cómo contar la jornada.
  if (efectivoId === null && sesiones.length > 0) throw new Error("leerControlesDeLaJornada: hay sesiones y no hay medio efectivo");
  const correcciones = jornadaId === null ? [] : await cargarCorreccionesDeLaJornada(db, empresaId, jornadaId);
  const conciliacion = conciliarJornada({
    efectivoId: efectivoId ?? "",
    movimientos: await cargarRegistradoPorMedio(db, empresaId, sesionIds),
    correcciones: correcciones.map((c) => ({ importeEnCentavos: c.importeEnCentavos, medioAntesId: c.medioAntesId, medioDespuesId: c.medioDespuesId })),
    declaraciones: jornadaId === null ? [] : await cargarDeclaracionesDeLaJornada(db, empresaId, jornadaId),
    conformeGeneral: jornadaId === null ? null : await cargarConformeGeneral(db, empresaId, jornadaId),
    cierres: await cargarCierresDeCaja(db, empresaId, sesionIds),
  });

  const cobranzas = args.soloImpedimentos === true ? [] : await cargarCobranzasDeLasSesiones(db, empresaId, sesionIds);
  const cobradoContraTicket: DatosParaLosControles["cobradoContraTicket"][number][] = [];
  for (const c of cobranzas) {
    const cuenta = await cargarCuentaParaCobrar(db, empresaId, c.cuentaId, args.ahora);
    const vigente = cuenta === null ? null : centavosDeImporte(cuenta.total);
    // Un total que no se puede leer: el día no se cierra con un dato que no se leyó (falla cerrado).
    if (vigente === null) throw new Error("leerControlesDeLaJornada: no se pudo leer el total vigente de una cuenta cobrada");
    cobradoContraTicket.push({ cobranzaId: c.cobranzaId, cuentaId: c.cuentaId, cobradoEnCentavos: c.totalEnCentavos, totalDelTicketEnCentavos: vigente });
  }

  const controles = controlesDelDia({
    sesiones: sesiones.map((s) => ({ id: s.id, estado: s.estado, diferenciaDeEfectivoEnCentavos: diferencias.get(s.id) ?? null })),
    conciliacion,
    cobradoContraTicket,
    correcciones,
    ajustes: await cargarAjustesQueCorrigen(db, empresaId, sesionIds),
    cuentasAbiertas: await cargarCuentasAbiertas(db, empresaId, sucursalId),
    cuentasPorCobrar: await cargarCuentasPorCobrar(db, { empresaId, sucursalId, fecha: fechaDeNegocio, zonaHoraria: args.zonaHoraria, horaDeCorte: horaDeCorteDeColumna(sucursal.horaDeCorte) }),
  });
  const huella = createHash("sha256").update(JSON.stringify(["HUELLA_DE_CONTROLES_DE_JORNADA", empresaId, sucursalId, fechaDeNegocio, ordenarControles(controles).map((c) => [c.clave, c.severidad, c.cantidad, c.detalle])])).digest("hex");
  return { controles, conciliacion, origenesConDiferencia: cobradoContraTicket.filter((t) => t.cobradoEnCentavos !== t.totalDelTicketEnCentavos), huella };
}
