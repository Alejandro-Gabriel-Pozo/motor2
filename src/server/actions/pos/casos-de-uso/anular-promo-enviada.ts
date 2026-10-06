import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_PROMO_NO_ENCONTRADA } from "@/core/features/cuentas/cuenta-anulacion.guard";
import type { ComandoAnularPromoEnviada, DatosAnularPromoEnviada, ResultadoAnularPromoEnviada } from "@/core/features/cuentas/cuenta-anulacion.schema";
import { conTransaccionSerializable } from "@/core/movimientos/public-servidor";
import { registrarCambioAuditado } from "@/core/permisos/auditoria";
import { restanteDe, validarMotivoAnulacion } from "@/core/pos/cuenta";
import { exito, fracaso } from "@/core/resultado-caso";
import { cargarPromoParaAnular } from "@/server/persistencia/pos/cargar-promo-para-anular";
import { escribirEspejoDeItem } from "@/server/persistencia/pos/escribir-espejo-de-item";
import { formatearCantidad } from "../cuenta-comun";

/**
 * Caso de uso «anular una promo ya enviada a cocina» (Task #41, Fase M12d — ver docs/arquitectura-casos-de-uso-2026-09-27.md). Es la
 * orquestación que antes vivía en línea en la Server Action `anularPromoEnviada` (src/server/actions/pos/cuenta-anulacion.ts), en el
 * MISMO orden y con los MISMOS textos; la Server Action quedó como adaptador fino. El criterio de negocio (Task #16, D4: la promo se anula
 * ENTERA, nunca un componente suelto) está documentado en la Server Action.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos (eso ya lo hizo `conPermiso("pos_anular_item")`) ni
 * el formato del `promoCuentaId` (`guardComandoAnularPromoEnviada`). Sin I3: nunca la tuvo — un segundo intento responde «ya está anulada
 * entera».
 *
 * Todo corre dentro de UNA transacción SERIALIZABLE (`conTransaccionSerializable`, con reintento ante un conflicto de escritura): todos
 * los componentes o ninguno. Un `fracaso(...)` devuelto desde adentro confirma la transacción sin haber escrito nada (cada rechazo sale
 * ANTES de escribir):
 *  1. carga de la promo con todos sus ítems, solo de una mesa de ESTA sucursal (persistencia);
 *  2. guardas de estado: la cuenta sigue abierta, la promo tiene componentes originales y TODOS ya salieron a cocina;
 *  3. el motivo (`validarMotivoAnulacion`);
 *  4. qué queda de cada componente (`restanteDe`): si a ninguno le queda nada, ya está anulada entera;
 *  5. por cada componente con resto, la fila espejo por ese resto íntegro, con el MISMO `promoCuentaId` (persistencia), y su fila de
 *     auditoría (entidad `CuentaItem`, campo `cantidadVigente`, resto → 0); y el mensaje.
 *
 * @contract Anula TODOS los componentes de una promo ya enviada, o ninguno — nunca un componente suelto.
 * @idempotency No aplica (nunca la tuvo) — un segundo intento ve "ya está anulada entera" (chequeo de estado, no I3).
 * @transaction conTransaccionSerializable (SERIALIZABLE + reintento).
 * @sideEffects registrarCambioAuditado (uno por cada componente anulado).
 * @ficha permiso=pos_anular_item transaccion=SERIALIZABLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO
 */
export async function anularPromoEnviadaCasoDeUso(
  actor: Pick<ContextoUsuario, "usuarioId" | "sucursalId" | "transaccion">,
  comando: ComandoAnularPromoEnviada
): Promise<ResultadoAnularPromoEnviada> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAnularPromoEnviada> => {
    const promo = await cargarPromoParaAnular(tx, { promoCuentaId: comando.promoCuentaId, sucursalId: actor.sucursalId });
    if (!promo) return fracaso("NO_ENCONTRADA", MENSAJE_PROMO_NO_ENCONTRADA);
    const mesa = promo.mesaNumero;
    if (promo.cuentaCerradaEn) return fracaso("CUENTA_CERRADA", `La cuenta de la mesa ${mesa} ya se cerró: anulá la venta (Reportes › Trazabilidad).`);

    const originales = promo.items.filter((i) => i.anulaAItemId === null);
    if (originales.length === 0) return fracaso("SIN_COMPONENTES", "Esa promo no tiene ningún componente.");
    const enviados = originales.flatMap((i) => (i.numeroEnvio === null ? [] : [{ ...i, numeroEnvio: i.numeroEnvio }]));
    if (enviados.length < originales.length) return fracaso("SIN_ENVIAR", "Esa promo todavía no salió a cocina: usá «Quitar promo».");

    const motivoValidado = validarMotivoAnulacion(comando.motivo);
    if (!motivoValidado.ok) return fracaso("MOTIVO_INVALIDO", motivoValidado.mensaje);

    const aAnular = enviados.map((item) => ({ item, restante: restanteDe({ cantidad: item.cantidad }, item.anulaciones) })).filter((x) => x.restante > 0);
    if (!aAnular.length) return fracaso("YA_ANULADA", `La promo «${promo.titulo}» ya está anulada entera.`);

    const componentes: DatosAnularPromoEnviada["componentes"] = [];
    for (const { item, restante } of aAnular) {
      const espejoId = await escribirEspejoDeItem(tx, {
        original: { id: item.id, cuentaId: item.cuentaId, productoId: item.productoId, precioUnitario: item.precioUnitario, precioCartaUnitario: item.precioCartaUnitario, numeroEnvio: item.numeroEnvio },
        cantidadAnulada: restante,
        motivo: motivoValidado.motivo,
        creadoPorId: actor.usuarioId,
        promo: { promoCuentaId: promo.id },
      });
      await registrarCambioAuditado(tx, {
        entidad: "CuentaItem",
        entidadId: item.id,
        descripcion: `Mesa ${mesa}, envío ${item.numeroEnvio}: anulación de la promo «${promo.titulo}» ya enviada a cocina — ${formatearCantidad(restante)} × "${item.producto.nombre}". Motivo: ${motivoValidado.motivo}`,
        campo: "cantidadVigente",
        valorAnterior: restante,
        valorNuevo: 0,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      componentes.push({ cuentaItemId: item.id, espejoId, cantidadAnulada: restante });
    }
    return exito(`Se anuló la promo «${promo.titulo}» de la mesa ${mesa} (${aAnular.length} componente${aAnular.length === 1 ? "" : "s"}).`, { componentes });
  });
}
