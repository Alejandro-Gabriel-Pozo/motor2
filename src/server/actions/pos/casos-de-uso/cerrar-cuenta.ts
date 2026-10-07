import "server-only";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { MENSAJE_CUENTA_NO_ENCONTRADA } from "@/core/features/cuentas/cuenta.guard";
import type { ComandoCerrarCuenta, ResultadoCerrarCuenta } from "@/core/features/cuentas/cuenta.schema";
import { precioCobradoConDescuentos } from "@/core/carta/public";
import { importeDeLinea, redondearMoneda } from "@/core/moneda";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { registrarVentaEnTx } from "@/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { lineasDeVenta } from "@/core/pos/cuenta";
import { siguienteNumeroTicket } from "@/core/pos/numeracion-ticket";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarCuentaParaCerrar, cargarOperacionDelConsumo, cargarUltimoNumeroDeTicket } from "@/server/persistencia/pos/cargar-cuenta-para-cerrar";
import { enlazarItemsConOperaciones, escribirEjemplarOriginalDeTicket, marcarCuentaCerrada } from "@/server/persistencia/pos/cerrar-cuenta";
import { describirAviso, formatearCantidad, MONEDA } from "../cuenta-comun";

/**
 * Caso de uso «cerrar la cuenta de una mesa» (Task #41, Fase M12a — ver docs/arquitectura-casos-de-uso-2026-09-27.md). Es la
 * orquestación que antes vivía en línea en la Server Action `cerrarCuenta` (src/server/actions/pos/cuenta-cierre.ts), en el MISMO orden
 * y con los MISMOS textos; la Server Action quedó como adaptador fino (permiso → guard → este caso de uso → `aResultadoAccion`). El
 * criterio de negocio completo (líneas netas, descuento de cliente D7, sección automática, stock negativo B6bis) está documentado en la
 * Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso("pos_cerrar_cuenta")`)
 * ni valida formato (eso lo hizo `guardComandoCerrarCuenta`). Sin I3: es idempotente POR ESTADO — una cuenta ya cerrada responde ok
 * (`YA_CERRADA`) sin escribir nada; la transacción serializable arbitra el doble clic (el segundo reintenta, la ve cerrada y no escribe).
 *
 * Un `fracaso(...)` devuelto desde adentro CONFIRMA la transacción (no hay throw): por eso cada rechazo sale ANTES de escribir nada —
 * igual que el `return error(...)` de antes —, y el número de ticket se asigna recién DESPUÉS de que la venta salió bien (numerar antes
 * gastaría un número en un cierre rechazado).
 *
 * Todo corre dentro de UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura):
 *  1. carga de la cuenta, solo de una mesa de ESTA sucursal (persistencia); ya cerrada → ok sin escribir; ítems sin enviar → rechazo;
 *  2. líneas netas (`lineasDeVenta`); neto cero → cierra sin venta;
 *  3. precio cobrado de cada línea (`precioConDescuento` con el snapshot del %, D7);
 *  4. la venta, con el MISMO núcleo que la de mostrador (`registrarVentaEnTx`, sin tocarlo), `permitirStockNegativo`;
 *  5. número de ticket (`max + 1`, ejemplar A), enlace ítem → Operacion y cierre de la cuenta (persistencia);
 *  6. una fila de auditoría por cada insumo que quedó en negativo, y el mensaje.
 *
 * @contract Cierra la cuenta de una mesa, registra la venta (aunque el stock quede negativo) y emite el ticket original.
 * @idempotency Por estado — una cuenta ya cerrada responde YA_CERRADA sin escribir nada; sin I3 (el aislamiento SERIALIZABLE arbitra el doble clic).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (uno por cada insumo que quedó en negativo, B6bis) — best-effort, no bloquea el cierre.
 * @ficha permiso=pos_cerrar_cuenta transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function cerrarCuentaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "email" | "transaccion" | "ahora">,
  comando: ComandoCerrarCuenta
): Promise<ResultadoCerrarCuenta> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoCerrarCuenta> => {
    const cuenta = await cargarCuentaParaCerrar(tx, { cuentaId: comando.cuentaId, sucursalId: actor.sucursalId });
    if (!cuenta) return fracaso("NO_ENCONTRADA", MENSAJE_CUENTA_NO_ENCONTRADA);
    const mesa = cuenta.mesaNumero;
    if (cuenta.cerradaEn) return exito(`La cuenta de la mesa ${mesa} ya estaba cerrada.`, { desenlace: "YA_CERRADA", operacionIds: [], numeroTicket: null, insumosEnNegativo: 0 });

    const sinEnviar = cuenta.items.filter((i) => i.numeroEnvio === null).length;
    if (sinEnviar > 0) {
      return fracaso("ITEMS_SIN_ENVIAR", sinEnviar === 1 ? "Hay 1 ítem sin enviar: envialo o quitalo." : `Hay ${sinEnviar} ítems sin enviar: envialos o quitalos.`);
    }

    const ahora = actor.ahora;
    const cerrar = () => marcarCuentaCerrada(tx, { cuentaId: cuenta.id, cerradaEn: ahora, cerradaPorId: actor.usuarioId });
    // `lineas`: precio de LISTA (congelado al pedir), agrupado por (producto, precio, promo) — es la clave con la que se enlaza cada
    // CuentaItem más abajo (CuentaItem.precioUnitario NUNCA cambia de semántica con el descuento de cliente, Task #14). `promoCuentaId`
    // (Task #16, D4) evita mezclar un suelto con un componente del mismo producto al mismo precio en la MISMA Operacion.
    const lineas = lineasDeVenta(cuenta.items);
    if (!lineas.length) {
      await cerrar();
      return exito(`Cuenta de la mesa ${mesa} cerrada sin venta: no quedó nada por cobrar.`, { desenlace: "SIN_VENTA", operacionIds: [], numeroTicket: null, insumosEnNegativo: 0 });
    }

    // Cliente con descuento (Task #14, D7): `descuentoPorcentaje` es el SNAPSHOT congelado al asignarlo, nunca el % actual de `Cliente`.
    // `precioConDescuento` hace la aritmética exacta y el piso de 0,01; sin cliente devuelve el precio de lista tal cual.
    const descuento = cuenta.descuentoPorcentaje;
    // Producto con descuento (Fase 2): si el suelto ya traía un descuento de producto, con el del cliente rige SOLO EL MAYOR (`precioCobradoConDescuentos`).
    // `precioListaUnitario` del movimiento sigue significando «descuento de CLIENTE»: solo se escribe cuando gana ese (el reporte de descuentos a
    // clientes lo lee); el descuento de producto vive en `CuentaItem.precioCartaUnitario` y tiene su propio reporte.
    // Los componentes de una promo NO traen precio de carta (`precioCartaUnitario` null): reciben el descuento de CLIENTE sobre su precio ya prorrateado. Es lo decidido en D2 de
    // docs/plan-promo-combo-2026-09-26.md (el descuento por cliente se suma SOBRE lo prorrateado, nunca antes) y lo fija la escena D1 de `venta-matriz-ampliada`.
    const lineasVenta = lineas.map((l) => {
      const cobro = precioCobradoConDescuentos(l.precioUnitario, l.precioCartaUnitario ?? null, descuento);
      return {
        productoId: l.productoId,
        cantidadVendida: l.cantidad,
        precioUnitario: cobro.precio,
        precioListaUnitario: cobro.origen === "cliente" ? (cobro.precioLista ?? undefined) : undefined,
        promoCuentaId: l.promoCuentaId,
      };
    });

    const venta = await registrarVentaEnTx(
      tx,
      { usuarioId: actor.usuarioId, sucursalId: actor.sucursalId, sucursalNombre: actor.sucursalNombre },
      {
        fecha: ahora,
        origen: { tipo: "automatico" },
        proveedorId: null,
        clienteId: cuenta.clienteId,
        detalle: `Mesa ${mesa}`,
        lineas: lineasVenta,
      },
      { permitirStockNegativo: true }
    );
    // El núcleo valida todo antes de escribir: un rechazo no dejó nada escrito y la cuenta sigue abierta.
    if (!venta.ok) return fracaso("VENTA_RECHAZADA", venta.mensaje);
    if (venta.operacionIds.length !== lineas.length) throw new Error("cerrarCuenta: la venta no devolvió una Operacion por línea.");

    // Número del ticket (docs/plan-numeracion-ticket-2026-09-25.md): max + 1 de la sucursal, ejemplar A. Recién DESPUÉS de que la venta
    // salió bien (ver el docstring).
    const numeroTicket = siguienteNumeroTicket(await cargarUltimoNumeroDeTicket(tx, actor.sucursalId));
    await escribirEjemplarOriginalDeTicket(tx, { sucursalId: actor.sucursalId, cuentaId: cuenta.id, numero: numeroTicket, emitidoEn: ahora, emitidoPorId: actor.usuarioId });

    await enlazarItemsConOperaciones(
      tx,
      cuenta.id,
      lineas.map((linea, i) => ({
        productoId: linea.productoId,
        precioUnitario: linea.precioUnitario,
        promoCuentaId: linea.promoCuentaId,
        precioCartaUnitario: linea.precioCartaUnitario,
        operacionId: venta.operacionIds[i],
      }))
    );
    await cerrar();

    const datos = { desenlace: "CON_VENTA" as const, operacionIds: venta.operacionIds, numeroTicket, insumosEnNegativo: venta.avisosStockNegativo.length };
    // Σ del importe COBRADO de cada línea VENTA registrada (importeDeLinea, igual que registrarVentaEnTx y el ticket — con descuento ya
    // aplicado si hay cliente), no la suma cruda re-redondeada: el total del mensaje coincide centavo a centavo con lo registrado.
    const total = redondearMoneda(lineasVenta.reduce((suma, l) => suma + importeDeLinea(l.cantidadVendida, l.precioUnitario), 0));
    const conCliente = cuenta.clienteNombre !== null ? ` (con ${descuento}% de descuento a «${cuenta.clienteNombre}»)` : "";
    const mensaje = `Cuenta de la mesa ${mesa} cerrada: se registró la venta por ${MONEDA.format(total)}${conCliente}.`;
    if (!venta.avisosStockNegativo.length) return exito(mensaje, datos);

    // STOCK INSUFICIENTE NO BLOQUEA (B6bis): cada insumo que quedó en negativo deja una fila de auditoría enlazada a la venta que lo
    // consumió en ESA sección.
    for (const aviso of venta.avisosStockNegativo) {
      const operacionDelConsumo = await cargarOperacionDelConsumo(tx, { operacionIds: venta.operacionIds, productoId: aviso.productoId, seccionId: aviso.seccionId });
      await registrarCambioAuditado(tx, {
        entidad: "Operacion",
        entidadId: operacionDelConsumo ?? venta.operacionIds[0],
        descripcion:
          `Mesa ${mesa}: al cerrar la cuenta (${actor.email}) el stock de "${aviso.nombre}" en «${aviso.seccionNombre}» quedó en negativo — ` +
          `tenía ${formatearCantidad(aviso.actual)}, la venta consumió ${formatearCantidad(aviso.requerido)}, faltaron ${formatearCantidad(aviso.requerido - Math.max(aviso.actual, 0))}. ` +
          "La venta se registró igual; corregí el saldo con un Conteo Físico o un Ajuste.",
        campo: "saldoStock",
        valorAnterior: aviso.actual,
        valorNuevo: aviso.resultante,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
    }
    return exito(`${mensaje} ⚠ Quedó stock negativo: ${venta.avisosStockNegativo.map(describirAviso).join(", ")}. Corregilo con un Conteo Físico o un Ajuste.`, datos);
  });
}
