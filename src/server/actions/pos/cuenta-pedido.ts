"use server";

import type { ItemParaAgregar, PromoParaAgregar } from "@/core/features/cuentas/cuenta-pedido.schema";
import { guardComandoAgregarItems, guardComandoEnviarACocina, guardComandoQuitarItemSinEnviar, guardComandoQuitarPromoSinEnviar } from "@/core/features/cuentas/cuenta-pedido.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion, type ResultadoEnvioACocina } from "../tipos";
import { agregarItemsCasoDeUso } from "./casos-de-uso/agregar-items";
import { enviarACocinaCasoDeUso } from "./casos-de-uso/enviar-a-cocina";
import { quitarItemSinEnviarCasoDeUso } from "./casos-de-uso/quitar-item-sin-enviar";
import { quitarPromoSinEnviarCasoDeUso } from "./casos-de-uso/quitar-promo-sin-enviar";

/**
 * Toma de pedido en el salón — cargar el pedido: agregar ítems y promos sin enviar, quitarlos mientras no salieron y enviarlos a cocina.
 * Criterio común de todas las acciones de «tomar pedido» (transacción SERIALIZABLE, mesa de la sucursal activa, cuenta abierta, sin
 * refrescar la vista) y ayudantes compartidos: ./cuenta-comun.ts. Desde el Hito 4 de la pureza (bloque 4.1, pasos 9 a 12) cada acción es un adaptador fino
 * de su caso de uso (./casos-de-uso/{agregar-items,quitar-promo-sin-enviar,quitar-item-sin-enviar,enviar-a-cocina}.ts).
 */

// MAXIMO_ITEMS_POR_AGREGADO vive en @/core/pos/cantidad-pedido (pura): así el cliente puede deshabilitar sumar el ítem #51 con el
// MISMO número, sin duplicarlo; lo aplica guardComandoAgregarItems. El tope de un envío a cocina (200) vive en su guard
// (core/features/cuentas/cuenta-pedido.guard.ts). Los tipos de los parámetros (ItemParaAgregar, PromoParaAgregar) viven en
// core/features/cuentas/cuenta-pedido.schema.ts.

/**
 * Agrega ítems SIN ENVIAR a una cuenta abierta: todo o nada. Cada producto tiene que ser un PV disponible en la sucursal; la cantidad
 * se valida y redondea a los decimales de su unidad (`validarCantidadPedido`). El precio se CONGELA acá (Precio Local habilitado o, si
 * no, el global — `resolverPrecioVenta`): es el que se cobra al cerrar la cuenta aunque cambie después.
 *
 * `promos` (Task #16, tercer parámetro OPCIONAL): cada promo se re-valida servidor-side con la MISMA fuente que el selector
 * (`cargarPromoCartaParaAgregar`, D5) — nunca se confía en lo que mandó el cliente sobre cupos/elegibles/precios —, se prorratea
 * (D3, `prorratearPrecioPromo`) y entra como una `PromoCuenta` nueva más sus `CuentaItem` componentes, cada uno con
 * `promoCuentaId` y `precioCartaUnitario`. TODA la validación (de los ítems sueltos Y de las promos) ocurre ANTES de la primera
 * escritura, mismo criterio que `registrarVentaEnTx`: un rechazo no deja nada escrito, sin importar en qué promo/ítem ocurrió.
 * `MAXIMO_ITEMS_POR_AGREGADO` cuenta también los componentes de cada promo (una elección con 3 productos elegidos cuenta 3),
 * no las promos en sí.
 *
 * Sin idempotencia I3 (O.12, documentado y fijado en el Hito 4): dos llamadas iguales DUPLICAN los ítems; solo la pantalla, que deshabilita el botón mientras
 * la acción está pendiente, frena el doble clic (no cubre dos pestañas ni un reintento de red). Ver el caso de uso.
 *
 * Desde el Hito 4 de la pureza (bloque 4.1, paso 12) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_tomar_pedido")`) → formato de las listas,
 * el tope y el `cuentaId` (`guardComandoAgregarItems`, core/features/cuentas/cuenta-pedido.guard.ts, DENTRO del envoltorio: los mismos chequeos de antes de la
 * transacción, en el mismo orden) → caso de uso (`casos-de-uso/agregar-items.ts`: transacción serializable, la cuenta abierta, la validación de cada ítem y
 * cada promo y las escrituras en server/persistencia/pos/pedido.ts) → `aResultadoAccion`. Con las cuatro migradas, el archivo entero está en
 * `ACCIONES_CON_CASO_DE_USO` (.dependency-cruiser-excepciones.cjs).
 */
export async function agregarItems(cuentaId: string, items: ItemParaAgregar[], promos?: PromoParaAgregar[]): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    const comando = guardComandoAgregarItems({ cuentaId, items, promos });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await agregarItemsCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Quita una promo entera que TODAVÍA NO SALIÓ a cocina: borra la `PromoCuenta` y TODOS sus `CuentaItem` componentes juntos, de
 * verdad (borradores, sin motivo ni auditoría — mismo criterio que `quitarItemSinEnviar`). Si algún componente ya salió a
 * cocina, no se borra nada: hay que anular la promo entera (`anularPromoEnviada`, D4).
 *
 * Desde el Hito 4 de la pureza (bloque 4.1, paso 10) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_tomar_pedido")`) → formato del
 * `promoCuentaId` (`guardComandoQuitarPromoSinEnviar`, core/features/cuentas/cuenta-pedido.guard.ts, DENTRO del envoltorio) → caso de uso
 * (`casos-de-uso/quitar-promo-sin-enviar.ts`: transacción serializable, la promo, la cuenta abierta, que nada haya salido y el borrado en
 * server/persistencia/pos/pedido.ts) → `aResultadoAccion`.
 */
export async function quitarPromoSinEnviar(promoCuentaId: string): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    const comando = guardComandoQuitarPromoSinEnviar({ promoCuentaId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await quitarPromoSinEnviarCasoDeUso(ctx, comando.valor));
  });
}

/**
 * Quita un ítem que TODAVÍA NO SALIÓ a cocina: es un borrador, así que se borra de verdad, sin motivo ni auditoría (plan, B3). La
 * condición vive en el mismo DELETE (`numeroEnvio: null`, y nunca una fila espejo): si otro mozo lo envió un instante antes, no se
 * borra nada. Un ítem ya enviado se anula con motivo (`anularItemEnviado`).
 *
 * Desde el Hito 4 de la pureza (bloque 4.1, paso 9) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_tomar_pedido")`) → formato del
 * `cuentaItemId` (`guardComandoQuitarItemSinEnviar`, core/features/cuentas/cuenta-pedido.guard.ts, DENTRO del envoltorio) → caso de uso
 * (`casos-de-uso/quitar-item-sin-enviar.ts`: transacción serializable, el ítem, la cuenta abierta y el borrado condicional en server/persistencia/pos/pedido.ts)
 * → `aResultadoAccion`.
 */
export async function quitarItemSinEnviar(cuentaItemId: string): Promise<ResultadoAccion> {
  return conPermiso("pos_tomar_pedido", async (ctx) => {
    const comando = guardComandoQuitarItemSinEnviar({ cuentaItemId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await quitarItemSinEnviarCasoDeUso(ctx, comando.valor));
  });
}

/**
 * «Enviar a cocina»: los ítems pedidos que sigan sin enviar pasan al envío `n = max(numeroEnvio) + 1` de la cuenta (KOT derivado, plan
 * B1). Solo los ids dados (los que el mozo tenía en pantalla): un ítem que otro agregó mientras tanto no sale sin que lo vea.
 * Idempotente: si ninguno seguía sin enviar (doble clic, otro mozo se adelantó), no crea un envío vacío.
 *
 * Además de `{ ok, mensaje }` devuelve `numeroEnvio` y `envioNuevo` (`ResultadoEnvioACocina`): la pantalla imprime la comanda solo del
 * envío que creó esta llamada; en el caso idempotente informa el envío en el que ya habían salido, con `envioNuevo: false`.
 *
 * Desde el Hito 4 de la pureza (bloque 4.1, paso 11) esta Server Action es un adaptador fino: permiso (`conPermiso("pos_enviar_a_cocina")`) → formato de la
 * lista y del `cuentaId` (`guardComandoEnviarACocina`, core/features/cuentas/cuenta-pedido.guard.ts, DENTRO del envoltorio: la lista primero, como antes) → caso
 * de uso (`casos-de-uso/enviar-a-cocina.ts`: transacción serializable, la cuenta abierta, los hermanos de promo, el número de envío y el `UPDATE` condicional en
 * server/persistencia/pos/pedido.ts). No usa `aResultadoAccion` (la pantalla necesita además el envío): copia a mano SOLO `numeroEnvio` y `envioNuevo` de
 * `datos`, como `emitirTicketCorregido`.
 */
export async function enviarACocina(cuentaId: string, itemIds: string[]): Promise<ResultadoEnvioACocina> {
  return conPermiso("pos_enviar_a_cocina", async (ctx) => {
    const comando = guardComandoEnviarACocina({ cuentaId, itemIds });
    if (!comando.ok) return error(comando.mensaje);
    const r = await enviarACocinaCasoDeUso(ctx, comando.valor);
    return r.ok ? { ...ok(r.mensaje), numeroEnvio: r.datos.numeroEnvio, envioNuevo: r.datos.envioNuevo } : error(r.mensaje);
  });
}
