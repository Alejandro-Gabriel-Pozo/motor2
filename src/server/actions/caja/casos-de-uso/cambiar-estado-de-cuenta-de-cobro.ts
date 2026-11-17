import "server-only";
import { decidirCambioDeEstado, sucursalEnAlcanceDeEscritura } from "@/core/caja/public";
import type { ComandoCambiarEstadoDeCuentaDeCobro, ResultadoDesactivarCuentaDeCobro, ResultadoReactivarCuentaDeCobro } from "@/core/features/caja/caja.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cambiarActivaDeCuenta, cargarCuentaDeCobro, esChoqueDeUnaActivaPorSucursal, hayOtraCuentaActivaEnSucursal } from "@/server/persistencia/caja/configuracion";

type Actor = Pick<ContextoDeAccion, "usuarioId" | "empresaId" | "transaccion" | "ahora" | "alcance">;

/** Lo común de desactivar y reactivar: cambia `activa` y audita, o dice que ya estaba como se pide (por estado: no escribe ni audita). */
async function cambiarEstado(actor: Actor, comando: ComandoCambiarEstadoDeCuentaDeCobro, seQuiereActiva: boolean) {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx) => {
      const actual = await cargarCuentaDeCobro(tx, actor.empresaId, comando.cuentaDeCobroId);
      if (!actual) return fracaso("CUENTA_DE_COBRO_NO_ENCONTRADA", "No se encontró la cuenta de cobro.");
      if (!sucursalEnAlcanceDeEscritura(actor.alcance, actual.sucursalId)) return fracaso("SUCURSAL_FUERA_DE_ALCANCE", "No tenés acceso a esa sucursal.");
      if (decidirCambioDeEstado(actual.activa, seQuiereActiva) === "YA_ESTABA") return { yaEstaba: true as const };
      // Una sola cuenta activa por sucursal (decisión del dueño, 2026-11-16, Q-C3-6): reactivar con otra activa en la sucursal es un rechazo de regla. Desactivar nunca choca.
      if (seQuiereActiva && (await hayOtraCuentaActivaEnSucursal(tx, actor.empresaId, actual.sucursalId, actual.id))) return fracaso("SUCURSAL_YA_TIENE_CUENTA_ACTIVA", "Esa sucursal ya tiene una cuenta de cobro activa: desactivala antes de activar o crear otra.");
      // El cambio se condiciona a la versión leída: si otro cambió la cuenta en el medio, la transacción serializable lo detecta y reintenta con lo nuevo.
      if (!(await cambiarActivaDeCuenta(tx, { empresaId: actor.empresaId, id: actual.id, versionEsperada: actual.version, ahora: actor.ahora, activa: seQuiereActiva }))) return fracaso("CUENTA_DE_COBRO_NO_ENCONTRADA", "No se encontró la cuenta de cobro.");
      await registrarCambioAuditado(tx, {
        entidad: "CuentaDeCobro",
        entidadId: actual.id,
        descripcion: `Cuenta de cobro ${actual.nombre}: ${seQuiereActiva ? "reactivada" : "desactivada"}`,
        campo: "activa",
        valorAnterior: !seQuiereActiva,
        valorNuevo: seQuiereActiva,
        actorId: actor.usuarioId,
        sucursalId: actual.sucursalId,
      });
      return { yaEstaba: false as const };
    },
    undefined,
    undefined,
    true,
  ).catch((e: unknown) => {
    if (seQuiereActiva && esChoqueDeUnaActivaPorSucursal(e)) return fracaso("SUCURSAL_YA_TIENE_CUENTA_ACTIVA" as const, "Esa sucursal ya tiene una cuenta de cobro activa: desactivala antes de activar o crear otra.");
    throw e;
  });
}

/**
 * Caso de uso «desactivar una cuenta de cobro» (etapa C3; Pedernal `desactivarCuentaDeCobro`). Ya inactiva → `yaEstabaInactiva` sin escribir ni auditar. Desactivarla no toca lo ya cobrado y, como la cuenta es opcional en el
 * cobro, desactivar todas no deja medios sin poder cobrar. `import "server-only"` y SIN `"use server"`.
 *
 * @contract Deja la cuenta inactiva (o ya lo estaba) y no toca ninguna otra fila.
 * @idempotency Por estado: repetirlo devuelve `yaEstabaInactiva` sin escribir ni auditar de nuevo.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (el cambio de estado).
 * @ficha permiso=caja_cuenta_de_cobro_desactivar|caja_cuenta_de_cobro_reactivar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function desactivarCuentaDeCobroCasoDeUso(actor: Actor, comando: ComandoCambiarEstadoDeCuentaDeCobro): Promise<ResultadoDesactivarCuentaDeCobro> {
  const r = await cambiarEstado(actor, comando, false);
  if ("ok" in r) {
    // Desactivar nunca choca con la regla de la cuenta activa única: el tipo de `cambiarEstado` la incluye porque la comparte con reactivar.
    if (r.codigo === "SUCURSAL_YA_TIENE_CUENTA_ACTIVA") throw new Error("desactivarCuentaDeCobro: la regla de la cuenta activa única no aplica al desactivar.");
    return r;
  }
  return exito(r.yaEstaba ? "La cuenta ya estaba desactivada." : "Cuenta de cobro desactivada.", { yaEstabaInactiva: r.yaEstaba });
}

/**
 * Caso de uso «reactivar una cuenta de cobro» (etapa C3; Pedernal `reactivarCuentaDeCobro`): lo mismo, hacia activa. Ya activa → `yaEstabaActiva`. Con OTRA activa en la sucursal → `SUCURSAL_YA_TIENE_CUENTA_ACTIVA` (una sola activa por sucursal, decisión del dueño 2026-11-16, Q-C3-6; no escribe nada). `import "server-only"` y SIN `"use server"`.
 *
 * @contract Deja la cuenta activa (o ya lo estaba) y no toca ninguna otra fila.
 * @idempotency Por estado: repetirlo devuelve `yaEstabaActiva` sin escribir ni auditar de nuevo.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento, también ante el choque de índice único).
 * @sideEffects registrarCambioAuditado (el cambio de estado).
 */
export async function reactivarCuentaDeCobroCasoDeUso(actor: Actor, comando: ComandoCambiarEstadoDeCuentaDeCobro): Promise<ResultadoReactivarCuentaDeCobro> {
  const r = await cambiarEstado(actor, comando, true);
  if ("ok" in r) return r;
  return exito(r.yaEstaba ? "La cuenta ya estaba activa." : "Cuenta de cobro reactivada.", { yaEstabaActiva: r.yaEstaba });
}
