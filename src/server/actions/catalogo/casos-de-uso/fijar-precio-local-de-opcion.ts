import "server-only";
import { MENSAJE_OPCION_NO_ENCONTRADA } from "@/core/features/catalogo/opciones-de-venta.guard";
import type { ComandoFijarPrecioLocalDeOpcion, ResultadoFijarPrecioLocalDeOpcion } from "@/core/features/catalogo/opciones-por-sucursal.schema";
import { cambiosPorColumna } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { filaDePrecioLocalDeOpcion } from "@/server/lecturas/catalogo/precio-local-de-opciones";
import { fijarPrecioLocalDeOpcion } from "@/server/persistencia/catalogo/opciones-por-sucursal";
import { cargarOpcionEnTx } from "./opciones-de-venta-en-tx";

/**
 * Caso de uso «fijar el precio de una opción para un producto en la sucursal ACTIVA» (la GRILLA del modo absoluto; GO-2a, ADR-030 §5, ADR-009 familia `override`: sin fila habilitada
 * rige el precio de la empresa). Va con la clave `precio_local`, cuyo gate ya exige la capacidad `precio_local` de la sucursal. Escribe SOLO en `actor.sucursalId`.
 *
 * Dentro de UNA transacción SERIALIZABLE:
 *  1. la opción existe y es una MEDIDA que el producto admite (su fila y la del grupo activas) en modo ABSOLUTO: el precio por sucursal de una variante o de un adicional no entra
 *     (GO-0 §8) → `NO_ADMITE_PRECIO_LOCAL`. Dar de baja (`precio: null`) no lo exige: una fila que ya no rige se puede apagar igual;
 *  2. si la grilla ya está como se pide (el mismo pedido repetido), éxito sin escribir;
 *  3. si no, el precio que vio la pantalla (`esperado`: precio y si regía, o «no había fila») tiene que ser el de la base; si otra persona lo cambió, `PRECIO_DESACTUALIZADO`
 *     (la tabla no tiene `version`: se compara el valor, como `habilitadaEsperada` de la receta propia);
 *  4. `upsert` (la baja es `habilitado = false`, conservando el último precio) y la auditoría de `precio` y de `habilitado` (solo lo que cambió), con la sucursal.
 * El precio ya llega validado (0,01 o más, con hasta 2 decimales: lo que trae más se rechaza en el guard, no se redondea).
 *
 * @contract Deja la grilla de esa opción y ese producto en la sucursal activa con el precio pedido, o la da de baja.
 * @idempotency Optimista — el precio esperado se compara dentro de la transacción; repetir el mismo pedido no escribe ni audita, y con un precio esperado viejo da `PRECIO_DESACTUALIZADO`.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: dos primeras altas de la misma celda chocan con el único `(sucursalId, productoId, opcionId)` y el reintento rechaza a la perdedora.
 * @sideEffects registrarCambioAuditado (`PrecioLocalDeOpcion`, `precio` y `habilitado`, con la sucursal), con el mismo `tx`.
 * @ficha permiso=precio_local transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function fijarPrecioLocalDeOpcionCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "transaccion" | "ahora">,
  comando: ComandoFijarPrecioLocalDeOpcion
): Promise<ResultadoFijarPrecioLocalDeOpcion> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoFijarPrecioLocalDeOpcion> => {
      const opcion = await cargarOpcionEnTx(tx, comando.opcionId);
      if (!opcion) return fracaso("OPCION_NO_ENCONTRADA", MENSAJE_OPCION_NO_ENCONTRADA);
      const producto = await tx.producto.findFirst({ where: { id: comando.productoId }, select: { id: true, nombre: true } });
      if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");

      if (comando.precio !== null) {
        const [admiteOpcion, admiteGrupo] = await Promise.all([
          tx.productoAdmiteOpcion.findUnique({ where: { productoId_opcionId: { productoId: producto.id, opcionId: opcion.id } }, select: { activo: true } }),
          tx.productoAdmiteGrupo.findUnique({ where: { productoId_grupoId: { productoId: producto.id, grupoId: opcion.grupoId } }, select: { activo: true, modoPrecio: true } }),
        ]);
        if (opcion.grupo.tipo !== "MEDIDA" || !admiteOpcion?.activo || !admiteGrupo?.activo || admiteGrupo.modoPrecio !== "ABSOLUTO") {
          return fracaso("NO_ADMITE_PRECIO_LOCAL", `«${producto.nombre}» no cobra «${opcion.nombre}» con precio propio: solo una medida con precio propio admitida por el producto tiene precio por sucursal.`);
        }
      }

      const clave = { sucursalId: actor.sucursalId, productoId: producto.id, opcionId: opcion.id };
      const fila = await filaDePrecioLocalDeOpcion(tx, clave);
      const nueva = comando.precio === null ? (fila ? { precio: fila.precio, habilitado: false } : null) : { precio: comando.precio, habilitado: true };
      const cambios = cambiosPorColumna([
        { campo: "precio", antes: fila?.precio ?? null, despues: nueva?.precio ?? null },
        { campo: "habilitado", antes: fila?.habilitado ?? null, despues: nueva?.habilitado ?? null },
      ]);
      const celda = `«${opcion.nombre}» de «${producto.nombre}» en «${actor.sucursalNombre}»`;
      if (nueva === null || cambios.length === 0) return exito(`El precio de ${celda} no tenía cambios.`, { huboCambio: false });

      const vioLoMismo = comando.esperado === null ? fila === null : fila !== null && fila.precio === comando.esperado.precio && fila.habilitado === comando.esperado.habilitado;
      if (!vioLoMismo) return fracaso("PRECIO_DESACTUALIZADO", `El precio de ${celda} cambió mientras lo editabas. Recargá la pantalla y volvé a hacer el cambio.`);

      await fijarPrecioLocalDeOpcion(tx, { ...clave, precio: nueva.precio, habilitado: nueva.habilitado, ahora: actor.ahora });
      const descripcion = nueva.habilitado ? `Precio de ${celda}: ${nueva.precio}.` : `Precio de ${celda}: vuelve a regir el de la empresa.`;
      for (const c of cambios) {
        await registrarCambioAuditado(tx, {
          entidad: "PrecioLocalDeOpcion",
          entidadId: `${actor.sucursalId}:${producto.id}:${opcion.id}`,
          campo: c.campo,
          descripcion,
          valorAnterior: c.antes,
          valorNuevo: c.despues,
          actorId: actor.usuarioId,
          sucursalId: actor.sucursalId,
        });
      }
      return exito(nueva.habilitado ? `Precio de ${celda} guardado.` : `Listo: en ${celda} vuelve a regir el precio de la empresa.`, { huboCambio: true });
    },
    undefined,
    undefined,
    true
  );
}
