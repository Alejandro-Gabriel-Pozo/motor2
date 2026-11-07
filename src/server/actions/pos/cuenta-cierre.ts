"use server";

import { guardComandoCerrarCuenta, guardComandoCorregirLineaDeTicket, guardComandoEmitirTicketCorregido, guardComandoQuitarUnidadesDeLinea } from "@/core/features/cuentas/cuenta.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { requierePermiso } from "@/server/acceso/gate";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion, type ResultadoTicketCorregido } from "../tipos";
import { cerrarCuentaCasoDeUso } from "./casos-de-uso/cerrar-cuenta";
import { corregirLineaDeTicketCasoDeUso } from "./casos-de-uso/corregir-linea-de-ticket";
import { quitarUnidadesDeLineaCasoDeUso } from "./casos-de-uso/quitar-unidades-de-linea";
import { emitirTicketCorregidoCasoDeUso } from "./casos-de-uso/emitir-ticket-corregido";

/**
 * Toma de pedido en el salón — cerrar la cuenta (registra la venta y numera el ticket) y emitir el ticket corregido.
 * Criterio común de todas las acciones de «tomar pedido» (transacción SERIALIZABLE, mesa de la sucursal activa, cuenta abierta, sin
 * refrescar la vista) y ayudantes compartidos: ./cuenta-comun.ts.
 */

/**
 * Cierra la cuenta de una mesa y registra su venta — pagar y cerrar son UNA sola acción atómica (plan B5: motor2 no tiene entidad de
 * caja ni de pago). En una transacción serializable:
 * 1. arma las líneas NETAS por (producto, precio congelado) sumando originales y espejos (`lineasDeVenta`); una línea anulada entera no
 *    se vende;
 * 2. si la cuenta tiene un cliente con descuento asignado (Task #14, docs/plan-clientes-descuento-2026-09-26.md, D7 — el snapshot
 *    congelado en `Cuenta.descuentoPorcentaje`, NUNCA el % actual de `Cliente`), aplica `precioConDescuento` sobre el precio de
 *    lista de cada línea (`src/core/moneda.ts`) — el precio de lista SOLO se guarda aparte (`precioListaUnitario`) cuando el
 *    descuento cambió el número; sin cliente, es un pasamanos: el precio congelado de siempre;
 * 3. registra la venta con el MISMO núcleo que la venta de mostrador (`registrarVentaEnTx`): una Operacion VENTA por línea, con
 *    `detalle` «Mesa N», el cliente de la cuenta (si tiene uno) y el precio COBRADO de cada línea (de lista, o con descuento). La
 *    sección NO se elige (docs/plan-seccion-habitual-stock-2026-09-25.md): el núcleo resuelve, insumo por insumo, de qué sección
 *    activa sale (`origen: { tipo: "automatico" }`, por vencimiento); sin ninguna sección activa, se rechaza sin escribir nada;
 * 4. enlaza cada ítem con su Operacion (`CuentaItem.operacionId`, buscado por el precio de LISTA — el descuento no cambia esa
 *    búsqueda) y cierra la cuenta (`cerradaEn`/`cerradaPorId`): la mesa queda libre.
 *
 * STOCK INSUFICIENTE NO BLOQUEA (plan B6bis, decisión del dueño): la mesa ya comió, así que la venta se registra igual
 * (`permitirStockNegativo`) y cada insumo que quedó en negativo sale EXPLÍCITO en el mensaje y deja una fila en el registro de auditoría
 * (entidad `Operacion` — la venta que lo consumió en ESA sección —, campo `saldoStock`, con la mesa, el insumo, la sección, el déficit y
 * quién cerró). Se corrige
 * después con las herramientas de siempre (Conteo Físico o Ajuste), sin ningún caso especial.
 *
 * Bloquea si queda algún ítem sin enviar (hay que enviarlo o quitarlo: lo que no salió a cocina no se cobra). Con neto cero (todo
 * anulado) cierra sin venta. Idempotente: una cuenta ya cerrada devuelve ok sin volver a vender (la transacción serializable arbitra el
 * doble clic: el segundo reintenta, la ve cerrada y no escribe nada).
 *
 * Adaptador fino: permiso
 * (`conPermiso`) → formato (`guardComandoCerrarCuenta`, core/features/cuentas/) → caso de uso (`casos-de-uso/cerrar-cuenta.ts`:
 * transacción, carga, venta con `registrarVentaEnTx`, numeración del ticket, enlace de ítems, cierre y auditoría; lecturas y escrituras
 * en server/persistencia/pos/) → `aResultadoAccion`.
 */
export async function cerrarCuenta(cuentaId: string): Promise<ResultadoAccion> {
  return conPermiso("pos_cerrar_cuenta", async (ctx) => {
    const comando = guardComandoCerrarCuenta({ cuentaId });
    if (!comando.ok) return error(comando.mensaje);
    return aResultadoAccion(await cerrarCuentaCasoDeUso(ctx, comando.valor));
  });
}

/**
 * «Emitir ticket corregido» (docs/plan-numeracion-ticket-2026-09-25.md, Fase 2): `anularVenta` anula UNA Operacion VENTA — una línea de
 * la mesa —, así que después de imprimir el ticket se puede anular solo el flan y dejar vigente la milanesa. El ticket impreso quedó
 * desactualizada; esta acción emite el EJEMPLAR SIGUIENTE con el MISMO número (566-A → 566-B), `corrigeAId` al ejemplar A (siempre al A,
 * nunca al anterior: criterio de `CuentaItem.anulaAItemId`), el motivo y quién lo emitió, más una fila en el registro de auditoría
 * (entidad `Cuenta`, campo `ejemplarTicket`). Nunca edita ni borra un ejemplar.
 *
 * Solo sobre una cuenta de la sucursal, cerrada CON número (las cerradas antes de la numeración no tienen ticket que corregir) y en estado
 * «desactualizada» (`estadoDeTicket`): si el último ejemplar ya refleja las anulaciones, o la venta se anuló entera, se rechaza. Mismo
 * permiso que cerrar la cuenta. La transacción serializable arbitra dos emisiones a la vez: la segunda reintenta, ve el B ya emitido
 * (vigente) y se rechaza.
 *
 * Adaptador fino: permiso
 * (`conPermiso`) → formato del `cuentaId` (`guardComandoEmitirTicketCorregido`, core/features/cuentas/) → caso de uso
 * (`casos-de-uso/emitir-ticket-corregido.ts`: transacción, carga, guardas de estado, motivo, ejemplar nuevo y auditoría; lectura y
 * escritura en server/persistencia/pos/) → `{ ok, mensaje, numero, ejemplar }`.
 */
export async function emitirTicketCorregido(cuentaId: string, motivo: string): Promise<ResultadoTicketCorregido> {
  return conPermiso("pos_emitir_ticket_corregido", async (ctx) => {
    const comando = guardComandoEmitirTicketCorregido({ cuentaId, motivo });
    if (!comando.ok) return error(comando.mensaje);
    const r = await emitirTicketCorregidoCasoDeUso(ctx, comando.valor);
    // Como `aResultadoAccion`, pero la pantalla necesita además QUÉ ejemplar se emitió (para imprimirlo): solo `numero` y `ejemplar` de
    // `datos` — nunca los ids internos.
    return r.ok ? { ...ok(r.mensaje), numero: r.datos.numero, ejemplar: r.datos.ejemplar } : error(r.mensaje);
  });
}

/**
 * «Corregir una línea» de una cuenta cerrada (E0 de la corrección por ajuste, docs/diseno-correccion-por-ajuste-2026-11-06.md): en UN paso y UNA transacción anula la
 * línea ENTERA (`operacionId` = su Operacion VENTA; una promo se anula entera, un adicional va con su producto), guarda el motivo en la venta y emite el ticket
 * corregido (el ejemplar siguiente, mismo número). Reemplaza el recorrido de tres pantallas (anular en Trazabilidad y después «Emitir ticket corregido»), que podía
 * quedar a medias.
 *
 * Permisos: `anular_venta` (piso administrador, lo pide `conPermiso`) y TAMBIÉN `pos_emitir_ticket_corregido`, pedido acá como primera línea: son las dos cosas que
 * hace. Sin claves nuevas. `ejemplarVisto` y `totalVisto` son lo que la persona tenía en pantalla (guarda optimista) y `claveIdempotencia` el UUID del diálogo (I3).
 *
 * Adaptador fino: permisos → formato (`guardComandoCorregirLineaDeTicket`) → caso de uso (`casos-de-uso/corregir-linea-de-ticket.ts`) → `{ ok, mensaje, numero, ejemplar }`.
 */
export async function corregirLineaDeTicket(
  cuentaId: string,
  operacionId: string,
  motivo: string,
  ejemplarVisto: number,
  totalVisto: number,
  claveIdempotencia: string
): Promise<ResultadoTicketCorregido> {
  return conPermiso("anular_venta", async (ctx) => {
    const tambien = await requierePermiso(ctx.usuarioId, ctx.sucursalId, "pos_emitir_ticket_corregido", ctx.db);
    if (!tambien.ok) return error(tambien.mensaje);
    const comando = guardComandoCorregirLineaDeTicket({ cuentaId, operacionId, motivo, ejemplarVisto, totalVisto, claveIdempotencia });
    if (!comando.ok) return error(comando.mensaje);
    const r = await corregirLineaDeTicketCasoDeUso(ctx, comando.valor);
    return r.ok ? { ...ok(r.mensaje), numero: r.datos.numero, ejemplar: r.datos.ejemplar } : error(r.mensaje);
  });
}

/**
 * «Quitar unidades de una línea» de una cuenta cerrada (E1 de la corrección por ajuste, docs/diseno-correccion-por-ajuste-2026-11-06.md): «cobré 2 cervezas y la mesa tomó 1».
 * En UN paso y UNA transacción reemplaza la venta de la línea por otra con las unidades que quedan (la quitada vuelve al stock), guarda el motivo y emite el ticket corregido
 * (el ejemplar siguiente, mismo número). `operacionId` es la venta VIGENTE de la línea (la de la lista de líneas corregibles). Quitar todas las unidades es `corregirLineaDeTicket`.
 *
 * Mismos permisos que la corrección de la línea entera: `anular_venta` (piso administrador) y `pos_emitir_ticket_corregido`. Sin claves nuevas. `unidadesVistas`, `ejemplarVisto` y
 * `totalVisto` son lo que la persona tenía en pantalla (guarda optimista) y `claveIdempotencia` el UUID del diálogo (I3).
 *
 * Adaptador fino: permisos → formato (`guardComandoQuitarUnidadesDeLinea`) → caso de uso (`casos-de-uso/quitar-unidades-de-linea.ts`) → `{ ok, mensaje, numero, ejemplar }`.
 */
export async function quitarUnidadesDeLinea(
  cuentaId: string,
  operacionId: string,
  unidadesAQuitar: number,
  unidadesVistas: number,
  motivo: string,
  ejemplarVisto: number,
  totalVisto: number,
  claveIdempotencia: string
): Promise<ResultadoTicketCorregido> {
  return conPermiso("anular_venta", async (ctx) => {
    const tambien = await requierePermiso(ctx.usuarioId, ctx.sucursalId, "pos_emitir_ticket_corregido", ctx.db);
    if (!tambien.ok) return error(tambien.mensaje);
    const comando = guardComandoQuitarUnidadesDeLinea({ cuentaId, operacionId, unidadesAQuitar, unidadesVistas, motivo, ejemplarVisto, totalVisto, claveIdempotencia });
    if (!comando.ok) return error(comando.mensaje);
    const r = await quitarUnidadesDeLineaCasoDeUso(ctx, comando.valor);
    return r.ok ? { ...ok(r.mensaje), numero: r.datos.numero, ejemplar: r.datos.ejemplar } : error(r.mensaje);
  });
}
