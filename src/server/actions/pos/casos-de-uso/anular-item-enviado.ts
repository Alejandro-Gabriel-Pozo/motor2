import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_ITEM_NO_ENCONTRADO } from "@/core/features/cuentas/cuenta-anulacion.guard";
import type { ComandoAnularItemEnviado, ResultadoAnularItemEnviado } from "@/core/features/cuentas/cuenta-anulacion.schema";
import { tieneStockReal } from "@/core/movimientos/public";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { validarCantidadPedido } from "@/core/pos/cantidad-pedido";
import { restanteDe, validarMotivoAnulacion } from "@/core/pos/cuenta";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarItemParaAnular } from "@/server/persistencia/pos/cargar-item-para-anular";
import { escribirEspejoDeItem } from "@/server/persistencia/pos/escribir-espejo-de-item";
import { formatearCantidad } from "../cuenta-comun";

/**
 * Caso de uso «anular un ítem ya enviado a cocina» (Task #41, Fase M12c — ver docs/arquitectura-casos-de-uso-2026-09-27.md). Es la
 * orquestación que antes vivía en línea en la Server Action `anularItemEnviado` (src/server/actions/pos/cuenta-anulacion.ts), en el MISMO
 * orden y con los MISMOS textos; la Server Action quedó como adaptador fino. El criterio de negocio (plan B2/B3: fila espejo, guarda
 * optimista, permiso propio) está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso("pos_anular_item")`) ni
 * el formato del `cuentaItemId` (`guardComandoAnularItemEnviado`). Sin I3: nunca la tuvo — el doble clic lo frena la guarda optimista.
 *
 * Todo corre dentro de UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura). Un
 * `fracaso(...)` devuelto desde adentro confirma la transacción sin haber escrito nada (cada rechazo sale ANTES de escribir):
 *  1. carga del ítem, solo de una mesa de ESTA sucursal (persistencia);
 *  2. guardas de estado: no es ya una anulación, la cuenta sigue abierta, ya salió a cocina, no es componente de una promo (Task #16, D4:
 *     la promo se anula entera con `anularPromoEnviada`);
 *  3. el motivo (`validarMotivoAnulacion`);
 *  4. la guarda optimista: `restanteVisto` tiene que ser EXACTAMENTE lo que queda (`restanteDe`);
 *  5. la cantidad (`validarCantidadPedido`, con la unidad y el paso de venta del producto) y que no supere lo que queda;
 *  6. la fila espejo (persistencia), la fila de auditoría (entidad `CuentaItem`, campo `cantidadVigente`) y el mensaje.
 *
 * @contract Anula parcial o totalmente un ítem YA enviado a cocina con una fila espejo, respetando una guarda optimista sobre lo que queda.
 * @idempotency No aplica (nunca la tuvo) — el doble clic lo frena la guarda optimista (restanteVisto tiene que coincidir EXACTO con lo que queda).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (campo cantidadVigente).
 * @ficha permiso=pos_anular_item transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function anularItemEnviadoCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "transaccion">,
  comando: ComandoAnularItemEnviado
): Promise<ResultadoAnularItemEnviado> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAnularItemEnviado> => {
    const item = await cargarItemParaAnular(tx, { cuentaItemId: comando.cuentaItemId, sucursalId: actor.sucursalId });
    if (!item) return fracaso("NO_ENCONTRADO", MENSAJE_ITEM_NO_ENCONTRADO);
    const mesa = item.mesaNumero;
    if (item.anulaAItemId !== null) return fracaso("ES_ANULACION", "Eso ya es una anulación: no se puede anular.");
    if (item.cuentaCerradaEn) return fracaso("CUENTA_CERRADA", `La cuenta de la mesa ${mesa} ya se cerró: anulá la venta (Reportes › Trazabilidad).`);
    const numeroEnvio = item.numeroEnvio;
    if (numeroEnvio === null) return fracaso("SIN_ENVIAR", "Ese ítem todavía no salió a cocina: usá «Quitar».");
    // Task #16 (D4, "una promo se anula entera"): un componente no se anula suelto — usá anularPromoEnviada con la promo.
    if (item.promoCuenta) return fracaso("COMPONENTE_DE_PROMO", `«${item.producto.nombre}» es parte de la promo «${item.promoCuenta.titulo}»: anulá la promo entera.`);

    const motivoValidado = validarMotivoAnulacion(comando.motivo);
    if (!motivoValidado.ok) return fracaso("MOTIVO_INVALIDO", motivoValidado.mensaje);

    const restante = restanteDe({ cantidad: item.cantidad }, item.anulaciones);
    if (typeof comando.restanteVisto !== "number" || comando.restanteVisto !== restante) {
      return fracaso("RESTANTE_CAMBIO", `«${item.producto.nombre}» cambió mientras lo mirabas (ahora quedan ${formatearCantidad(restante)}): revisá y volvé a intentar.`);
    }
    const { producto } = item;
    const pasoDelItem = producto.pasoVenta !== null ? { pasoVenta: producto.pasoVenta, tieneStockReal: tieneStockReal(producto.tipo, producto.seProduce) } : null;
    const aAnular = validarCantidadPedido(comando.cantidad, producto.decimales, pasoDelItem);
    if (!aAnular.ok) return fracaso("CANTIDAD_INVALIDA", aAnular.mensaje);
    if (aAnular.cantidad > restante) return fracaso("EXCEDE_RESTANTE", `No se puede anular más de lo que queda de «${producto.nombre}» (${formatearCantidad(restante)}).`);

    const espejoId = await escribirEspejoDeItem(tx, {
      original: { id: item.id, cuentaId: item.cuentaId, productoId: item.productoId, precioUnitario: item.precioUnitario, precioCartaUnitario: item.precioCartaUnitario, numeroEnvio },
      cantidadAnulada: aAnular.cantidad,
      motivo: motivoValidado.motivo,
      creadoPorId: actor.usuarioId,
    });
    const quedan = restanteDe({ cantidad: restante }, [{ cantidad: -aAnular.cantidad }]);
    await registrarCambioAuditado(tx, {
      entidad: "CuentaItem",
      entidadId: item.id,
      descripcion: `Mesa ${mesa}, envío ${numeroEnvio}: anulación de ${formatearCantidad(aAnular.cantidad)} × "${producto.nombre}" ya enviado a cocina. Motivo: ${motivoValidado.motivo}`,
      campo: "cantidadVigente",
      valorAnterior: restante,
      valorNuevo: quedan,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
    return exito(`Se anuló ${formatearCantidad(aAnular.cantidad)} × «${producto.nombre}» de la mesa ${mesa}.`, {
      espejoId,
      cantidadAnulada: aAnular.cantidad,
      restanteAntes: restante,
      restanteDespues: quedan,
    });
  });
}
