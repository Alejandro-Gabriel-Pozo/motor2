"use server";

import { guardComandoCerrarCuenta, guardComandoEmitirTicketCorregido } from "@/core/features/cuentas/cuenta.guard";
import { aResultadoAccion } from "@/core/resultado-caso";
import { conPermiso } from "../con-permiso";
import { error, ok, type ResultadoAccion, type ResultadoTicketCorregido } from "../tipos";
import { cerrarCuentaCasoDeUso } from "./casos-de-uso/cerrar-cuenta";
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
 * Desde la Task #41 (Fase M12a, docs/arquitectura-casos-de-uso-2026-09-27.md) esta Server Action es un adaptador fino: permiso
 * (`conPermiso`) → formato (`guardComandoCerrarCuenta`, core/features/cuentas/) → caso de uso (`casos-de-uso/cerrar-cuenta.ts`:
 * transacción, carga, venta con `registrarVentaEnTx`, numeración del ticket, enlace de ítems, cierre y auditoría; lecturas y escrituras
 * en server/persistencia/pos/) → `aResultadoAccion`. Con `emitirTicketCorregido` (abajo, M12b) también migrada, el archivo entero está
 * en `ACCIONES_CON_CASO_DE_USO` (.dependency-cruiser-excepciones.cjs).
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
 * Desde la Task #41 (Fase M12b, docs/arquitectura-casos-de-uso-2026-09-27.md) esta Server Action es un adaptador fino: permiso
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
