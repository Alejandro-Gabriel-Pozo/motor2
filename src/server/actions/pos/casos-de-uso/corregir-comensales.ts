import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import type { ComandoCorregirComensales, ResultadoCorregirComensales } from "@/core/features/cuentas/cuenta-apertura.schema";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { validarComensales } from "@/core/pos/cuenta";
import { exito, fracaso } from "@/core/resultado-caso";
import { cambiarComensalesDeCuenta } from "@/server/persistencia/pos/cuenta";
import { cuentaAbiertaDeSucursal } from "../cuenta-comun";

/**
 * Caso de uso «corregir los comensales de una cuenta abierta» (Hito 4 de la pureza, bloque 4.1, paso 6 — `docs/plan-hito-4-pureza.md` §5). Es el cuerpo que
 * antes vivía en línea en la Server Action `corregirComensales` (`src/server/actions/pos/cuenta-apertura.ts`), movido TAL CUAL: la misma transacción
 * SERIALIZABLE, el mismo orden de chequeos y los mismos mensajes. La Server Action quedó como adaptador (`conPermiso("pos_abrir_cuenta")` →
 * `guardComandoCorregirComensales` → este caso de uso → `aResultadoAccion`). El criterio de negocio (una cuenta cerrada no se toca: el dato queda congelado)
 * está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (`conPermiso`) ni que el id sea un texto (el guard).
 *
 * Orden, igual que antes, dentro de la transacción: 1. la cuenta, de una mesa de ESTA sucursal y abierta (`cuentaAbiertaDeSucursal`, de `../cuenta-comun.ts`):
 * gana sobre un valor inválido de comensales; 2. `validarComensales`; 3. el cambio (`cambiarComensalesDeCuenta`, server/persistencia/pos/cuenta.ts).
 *
 * @contract Deja en la cuenta abierta de una mesa de la sucursal la cantidad de comensales pedida (un entero entre 1 y 99).
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo valor; una cuenta ya cerrada se rechaza.
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects Ninguno (sin auditoría: la cuenta es su propio documento, como antes).
 * @ficha permiso=pos_abrir_cuenta transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function corregirComensalesCasoDeUso(
  actor: Pick<ContextoUsuario, "sucursalId" | "transaccion">,
  comando: ComandoCorregirComensales,
): Promise<ResultadoCorregirComensales> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoCorregirComensales> => {
    const abierta = await cuentaAbiertaDeSucursal(tx, comando.cuentaId, actor.sucursalId);
    if (!abierta.ok) return fracaso("CUENTA_NO_ABIERTA", abierta.mensaje);

    const val = validarComensales(comando.comensales);
    if (!val.ok) return fracaso("COMENSALES_INVALIDOS", val.mensaje);

    await cambiarComensalesDeCuenta(tx, { cuentaId: abierta.cuenta.id, comensales: val.comensales });
    return exito(`Comensales de la mesa ${abierta.cuenta.mesa.numero} actualizados a ${val.comensales}.`, null);
  });
}
