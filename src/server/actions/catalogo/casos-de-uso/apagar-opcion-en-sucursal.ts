import "server-only";
import { MENSAJE_OPCION_NO_ENCONTRADA } from "@/core/features/catalogo/opciones-de-venta.guard";
import type { ComandoApagarOpcionEnSucursal, ResultadoApagarOpcionEnSucursal } from "@/core/features/catalogo/opciones-por-sucursal.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { fijarApagadoDeOpcion } from "@/server/persistencia/catalogo/opciones-por-sucursal";
import { cargarOpcionEnTx } from "./opciones-de-venta-en-tx";

/**
 * Caso de uso «apagar o prender una opción de venta en la sucursal ACTIVA» (GO-2a; ADR-030 §5, ADR-009 familia `optout`: sin fila = prendida). Escribe SOLO en `actor.sucursalId`
 * (la sucursal activa del contexto, nunca una que llegue por parámetro: el guard ya comparó el eco de la pantalla con la activa); la política por sucursal de GO-1c-rls es la
 * segunda barrera (42501).
 *
 * «Llevar al estado X»: dentro de UNA transacción SERIALIZABLE lee la fila de la sucursal; si ya está así, no escribe ni audita. Si no, `upsert` y una fila de auditoría con el
 * antes y el después (con la sucursal). Un apagado y un prendido a la vez se ordenan (los dos leen y escriben la misma fila: SERIALIZABLE aborta a uno y su reintento relee), así
 * que la cadena de auditoría queda coherente: el «antes» de la segunda es el «después» de la primera.
 *
 * @contract Deja la opción apagada o prendida en la sucursal activa, como se pide.
 * @idempotency Por estado — si la opción ya está en el estado pedido no se escribe ni se audita: repetir el pedido no cambia nada.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: dos primeros apagados a la vez chocan con el único `(sucursalId, opcionId)` y el reintento da el resultado de negocio.
 * @sideEffects registrarCambioAuditado (`OpcionApagadaEnSucursal`, `apagada`, con la sucursal), con el mismo `tx`.
 * @ficha permiso=opcion_apagar_en_sucursal transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function apagarOpcionEnSucursalCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "transaccion" | "ahora">,
  comando: ComandoApagarOpcionEnSucursal
): Promise<ResultadoApagarOpcionEnSucursal> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoApagarOpcionEnSucursal> => {
      const opcion = await cargarOpcionEnTx(tx, comando.opcionId);
      if (!opcion) return fracaso("OPCION_NO_ENCONTRADA", MENSAJE_OPCION_NO_ENCONTRADA);
      const fila = await tx.opcionApagadaEnSucursal.findUnique({
        where: { sucursalId_opcionId: { sucursalId: actor.sucursalId, opcionId: opcion.id } },
        select: { apagada: true },
      });
      const estaba = fila?.apagada ?? false;
      const estado = comando.apagada ? "apagada" : "prendida";
      if (estaba === comando.apagada) return exito(`«${opcion.nombre}» ya estaba ${estado} en «${actor.sucursalNombre}».`, { huboCambio: false });

      await fijarApagadoDeOpcion(tx, { sucursalId: actor.sucursalId, opcionId: opcion.id, apagada: comando.apagada, actorId: actor.usuarioId, ahora: actor.ahora });
      await registrarCambioAuditado(tx, {
        entidad: "OpcionApagadaEnSucursal",
        entidadId: `${actor.sucursalId}:${opcion.id}`,
        campo: "apagada",
        descripcion: `Opción «${opcion.nombre}» de «${opcion.grupo.nombre}» en «${actor.sucursalNombre}»: ${estado}.`,
        valorAnterior: estaba,
        valorNuevo: comando.apagada,
        actorId: actor.usuarioId,
        sucursalId: actor.sucursalId,
      });
      return exito(`«${opcion.nombre}» quedó ${estado} en «${actor.sucursalNombre}».`, { huboCambio: true });
    },
    undefined,
    undefined,
    true
  );
}
