import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { MENSAJE_CUENTA_NO_ENCONTRADA } from "@/core/features/cuentas/cuenta.guard";
import type { ComandoEmitirTicketCorregido, ResultadoEmitirTicketCorregido } from "@/core/features/cuentas/cuenta.schema";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { armarTicketVigente, estadoDeTicket } from "@/core/pos/ticket";
import { validarMotivoAnulacion } from "@/core/pos/cuenta";
import { formatearNumeroTicket } from "@/core/pos/numeracion-ticket";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarCuentaParaCorregirTicket } from "@/server/persistencia/pos/cargar-cuenta-para-corregir-ticket";
import { escribirEjemplarCorregido } from "@/server/persistencia/pos/escribir-ejemplar-corregido";

/**
 * Caso de uso «emitir ticket corregido» (Task #41, Fase M12b — ver docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación que
 * antes vivía en línea en la Server Action `emitirTicketCorregido` (src/server/actions/pos/cuenta-cierre.ts), en el MISMO orden y con los
 * MISMOS textos; la Server Action quedó como adaptador fino. El criterio de negocio (docs/plan-numeracion-ticket-2026-09-25.md, Fase 2)
 * está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso("pos_emitir_ticket_corregido")`)
 * ni el formato del `cuentaId` (`guardComandoEmitirTicketCorregido`). Sin I3: nunca la tuvo — una segunda emisión ve el B vigente y se
 * rechaza.
 *
 * Todo corre dentro de UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura), que
 * arbitra dos emisiones a la vez: la segunda reintenta, ve el B ya emitido (vigente) y se rechaza. Un `fracaso(...)` devuelto desde
 * adentro confirma la transacción sin haber escrito nada (cada rechazo sale ANTES de escribir):
 *  1. carga de la cuenta, solo de una mesa de ESTA sucursal, con sus ítems y ejemplares (persistencia);
 *  2. guardas de estado: cerrada, con ejemplar A (numerada), ni anulada entera ni ya vigente (`estadoDeTicket`, `armarTicketVigente`);
 *  3. el motivo (`validarMotivoAnulacion`) — recién acá, igual que antes;
 *  4. el ejemplar siguiente con el MISMO número y `corrigeAId` SIEMPRE al A, nunca al anterior (persistencia);
 *  5. la fila de auditoría (entidad `Cuenta`, campo `ejemplarTicket`: del último ejemplar al nuevo) y el mensaje.
 *
 * @contract Emite un nuevo ejemplar de ticket que refleja las anulaciones vigentes, corrigiendo siempre al ejemplar A original.
 * @idempotency No aplica (nunca la tuvo) — una segunda emisión ve el ejemplar ya vigente y se rechaza (chequeo de estado, no I3).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (campo ejemplarTicket).
 * @ficha permiso=pos_emitir_ticket_corregido transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function emitirTicketCorregidoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "transaccion" | "ahora">,
  comando: ComandoEmitirTicketCorregido
): Promise<ResultadoEmitirTicketCorregido> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoEmitirTicketCorregido> => {
    const cuenta = await cargarCuentaParaCorregirTicket(tx, { cuentaId: comando.cuentaId, sucursalId: actor.sucursalId });
    if (!cuenta) return fracaso("NO_ENCONTRADA", MENSAJE_CUENTA_NO_ENCONTRADA);
    const mesa = cuenta.mesaNumero;
    if (!cuenta.cerradaEn) return fracaso("CUENTA_ABIERTA", `La cuenta de la mesa ${mesa} todavía está abierta: no tiene ticket que corregir.`);
    const [ultimo] = cuenta.ejemplares;
    const original = cuenta.ejemplares.find((e) => e.ejemplar === 1);
    if (!ultimo || !original) {
      return fracaso("SIN_NUMERACION", `La cuenta de la mesa ${mesa} se cerró antes de la numeración de tickets: no tiene ticket que corregir.`);
    }

    const estado = estadoDeTicket(cuenta.items, ultimo.emitidoEn);
    if (estado === "anulada" || !armarTicketVigente(cuenta.items, actor.ahora).lineas.length) return fracaso("VENTA_ANULADA", "La venta se anuló entera: no hay ticket que corregir.");
    if (estado === "vigente") return fracaso("TICKET_VIGENTE", `El ticket N.º ${formatearNumeroTicket(ultimo)} ya refleja las anulaciones.`);

    const motivoValidado = validarMotivoAnulacion(comando.motivo);
    if (!motivoValidado.ok) return fracaso("MOTIVO_INVALIDO", motivoValidado.mensaje);

    const nuevo = { numero: original.numero, ejemplar: ultimo.ejemplar + 1 };
    const ejemplarId = await escribirEjemplarCorregido(tx, {
      sucursalId: original.sucursalId,
      cuentaId: cuenta.id,
      ...nuevo,
      emitidoEn: actor.ahora,
      emitidoPorId: actor.usuarioId,
      corrigeAId: original.id,
      motivo: motivoValidado.motivo,
    });
    const [anterior, emitido, reemplazado] = [formatearNumeroTicket(ultimo), formatearNumeroTicket(nuevo), formatearNumeroTicket(original)];
    await registrarCambioAuditado(tx, {
      entidad: "Cuenta",
      entidadId: cuenta.id,
      descripcion: `Mesa ${mesa}: ticket corregido N.º ${emitido} (reemplaza a N.º ${reemplazado}). Motivo: ${motivoValidado.motivo}`,
      campo: "ejemplarTicket",
      valorAnterior: anterior,
      valorNuevo: emitido,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito(`Ticket N.º ${emitido} emitida: reemplaza a N.º ${reemplazado}.`, { ...nuevo, ejemplarId, corrigeAId: original.id });
    // `true`: dos emisiones simultáneas leen el mismo último ejemplar; la que pierde recibe el choque del ejemplar duplicado y, al repetir, ve el ticket ya
    // vigente y responde `TICKET_VIGENTE` en vez de escapar como error de base.
  }, 5, {}, true);
}
