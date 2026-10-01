import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_CUENTA_NO_ENCONTRADA } from "@/core/features/cuentas/cuenta.guard";
import type { ComandoEmitirBoletaCorregida, ResultadoEmitirBoletaCorregida } from "@/core/features/cuentas/cuenta.schema";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { armarBoletaVigente, estadoDeBoleta } from "@/core/pos/boleta";
import { validarMotivoAnulacion } from "@/core/pos/cuenta";
import { formatearNumeroBoleta } from "@/core/pos/numeracion-boleta";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarCuentaParaCorregirBoleta } from "@/server/persistencia/pos/cargar-cuenta-para-corregir-boleta";
import { escribirEjemplarCorregido } from "@/server/persistencia/pos/escribir-ejemplar-corregido";

/**
 * Caso de uso «emitir boleta corregida» (Task #41, Fase M12b — ver docs/arquitectura-casos-de-uso-2026-09-27.md). Es la orquestación que
 * antes vivía en línea en la Server Action `emitirBoletaCorregida` (src/server/actions/pos/cuenta-cierre.ts), en el MISMO orden y con los
 * MISMOS textos; la Server Action quedó como adaptador fino. El criterio de negocio (docs/plan-numeracion-boleta-2026-09-25.md, Fase 2)
 * está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso("pos_emitir_boleta_corregida")`)
 * ni el formato del `cuentaId` (`guardComandoEmitirBoletaCorregida`). Sin I3: nunca la tuvo — una segunda emisión ve el B vigente y se
 * rechaza.
 *
 * Todo corre dentro de UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura), que
 * arbitra dos emisiones a la vez: la segunda reintenta, ve el B ya emitido (vigente) y se rechaza. Un `fracaso(...)` devuelto desde
 * adentro confirma la transacción sin haber escrito nada (cada rechazo sale ANTES de escribir):
 *  1. carga de la cuenta, solo de una mesa de ESTA sucursal, con sus ítems y ejemplares (persistencia);
 *  2. guardas de estado: cerrada, con ejemplar A (numerada), ni anulada entera ni ya vigente (`estadoDeBoleta`, `armarBoletaVigente`);
 *  3. el motivo (`validarMotivoAnulacion`) — recién acá, igual que antes;
 *  4. el ejemplar siguiente con el MISMO número y `corrigeAId` SIEMPRE al A, nunca al anterior (persistencia);
 *  5. la fila de auditoría (entidad `Cuenta`, campo `ejemplarBoleta`: del último ejemplar al nuevo) y el mensaje.
 *
 * @contract Emite un nuevo ejemplar de boleta que refleja las anulaciones vigentes, corrigiendo siempre al ejemplar A original.
 * @idempotency No aplica (nunca la tuvo) — una segunda emisión ve el ejemplar ya vigente y se rechaza (chequeo de estado, no I3).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (campo ejemplarBoleta).
 */
export async function emitirBoletaCorregidaCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "transaccion">,
  comando: ComandoEmitirBoletaCorregida
): Promise<ResultadoEmitirBoletaCorregida> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoEmitirBoletaCorregida> => {
    const cuenta = await cargarCuentaParaCorregirBoleta(tx, { cuentaId: comando.cuentaId, sucursalId: actor.sucursalId });
    if (!cuenta) return fracaso("NO_ENCONTRADA", MENSAJE_CUENTA_NO_ENCONTRADA);
    const mesa = cuenta.mesaNumero;
    if (!cuenta.cerradaEn) return fracaso("CUENTA_ABIERTA", `La cuenta de la mesa ${mesa} todavía está abierta: no tiene boleta que corregir.`);
    const [ultimo] = cuenta.ejemplares;
    const original = cuenta.ejemplares.find((e) => e.ejemplar === 1);
    if (!ultimo || !original) {
      return fracaso("SIN_NUMERACION", `La cuenta de la mesa ${mesa} se cerró antes de la numeración de boletas: no tiene boleta que corregir.`);
    }

    const estado = estadoDeBoleta(cuenta.items, ultimo.emitidoEn);
    if (estado === "anulada" || !armarBoletaVigente(cuenta.items).lineas.length) return fracaso("VENTA_ANULADA", "La venta se anuló entera: no hay boleta que corregir.");
    if (estado === "vigente") return fracaso("BOLETA_VIGENTE", `La boleta N.º ${formatearNumeroBoleta(ultimo)} ya refleja las anulaciones.`);

    const motivoValidado = validarMotivoAnulacion(comando.motivo);
    if (!motivoValidado.ok) return fracaso("MOTIVO_INVALIDO", motivoValidado.mensaje);

    const nuevo = { numero: original.numero, ejemplar: ultimo.ejemplar + 1 };
    const ejemplarId = await escribirEjemplarCorregido(tx, {
      sucursalId: original.sucursalId,
      cuentaId: cuenta.id,
      ...nuevo,
      emitidoEn: new Date(),
      emitidoPorId: actor.usuarioId,
      corrigeAId: original.id,
      motivo: motivoValidado.motivo,
    });
    const [anterior, emitido, reemplazado] = [formatearNumeroBoleta(ultimo), formatearNumeroBoleta(nuevo), formatearNumeroBoleta(original)];
    await registrarCambioAuditado(tx, {
      entidad: "Cuenta",
      entidadId: cuenta.id,
      descripcion: `Mesa ${mesa}: boleta corregida N.º ${emitido} (reemplaza a N.º ${reemplazado}). Motivo: ${motivoValidado.motivo}`,
      campo: "ejemplarBoleta",
      valorAnterior: anterior,
      valorNuevo: emitido,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito(`Boleta N.º ${emitido} emitida: reemplaza a N.º ${reemplazado}.`, { ...nuevo, ejemplarId, corrigeAId: original.id });
  });
}
