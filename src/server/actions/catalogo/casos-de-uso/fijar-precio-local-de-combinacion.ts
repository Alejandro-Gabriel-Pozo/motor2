import "server-only";
import type { ComandoFijarPrecioLocalDeCombinacion, ResultadoFijarPrecioLocalDeCombinacion } from "@/core/features/catalogo/combinaciones.schema";
import { cambiosPorColumna } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { filaDePrecioLocalDeCombinacion } from "@/server/lecturas/catalogo/precio-local-de-combinaciones";
import { fijarPrecioLocalDeCombinacion } from "@/server/persistencia/catalogo/combinaciones";

/**
 * Caso de uso «el precio de una combinación o de una tarifa en la sucursal ACTIVA» (GO-3b, ADR-032, D-4, paso AB4; ADR-009 familia `override`: sin fila habilitada rige el de la empresa). Va con la
 * clave `precio_local`, cuyo gate ya exige la capacidad `precio_local` de la sucursal. Escribe SOLO en `actor.sucursalId` (el guard comparó el eco; las políticas por sucursal son la segunda barrera).
 *
 * Dentro de UNA transacción SERIALIZABLE: la combinación o la tarifa existen (otra empresa no se ve); si ya está como se pide, éxito sin escribir; si no, el precio que vio la pantalla tiene que ser el de
 * la base (`PRECIO_DESACTUALIZADO`: la tabla no tiene `version`, se compara el valor, como la grilla de las opciones); `upsert` (la baja es `habilitado = false`) y la auditoría de `precio` y
 * `habilitado` (solo lo que cambió), con la sucursal. Si la combinación usa una tarifa, rige el precio local de la TARIFA (la precedencia es pura: `resolverPrecioDeCombinacion`).
 *
 * @contract Deja el precio local pedido de la combinación o de la tarifa en la sucursal activa, o lo da de baja, con su auditoría.
 * @idempotency Optimista — el precio esperado se compara dentro de la transacción; el mismo pedido repetido no escribe ni audita.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: dos primeras altas de la misma celda chocan con su único y el reintento rechaza a la perdedora.
 * @sideEffects registrarCambioAuditado (`PrecioLocalDeCombinacion`, `precio` y `habilitado`, con la sucursal), con el mismo `tx`.
 * @ficha permiso=precio_local transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function fijarPrecioLocalDeCombinacionCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "transaccion" | "ahora">,
  comando: ComandoFijarPrecioLocalDeCombinacion,
): Promise<ResultadoFijarPrecioLocalDeCombinacion> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoFijarPrecioLocalDeCombinacion> => {
      let nombre: string;
      let entidadId: string;
      if ("combinacionId" in comando.objetivo) {
        const c = await tx.combinacionDeProducto.findFirst({
          where: { id: comando.objetivo.combinacionId },
          select: { id: true, producto: { select: { nombre: true } }, opcionEje1: { select: { nombre: true } }, opcionEje2: { select: { nombre: true } } },
        });
        if (!c) return fracaso("COMBINACION_NO_ENCONTRADA", "No se encontró esa combinación.");
        nombre = `la combinación «${[c.producto.nombre, c.opcionEje1.nombre, c.opcionEje2?.nombre].filter(Boolean).join(" · ")}»`;
        entidadId = `${actor.sucursalId}:${c.id}`;
      } else {
        const g = await tx.grupoDePrecio.findFirst({ where: { id: comando.objetivo.grupoDePrecioId }, select: { id: true, nombre: true } });
        if (!g) return fracaso("GRUPO_DE_PRECIO_NO_ENCONTRADO", "No se encontró esa tarifa.");
        nombre = `la tarifa «${g.nombre}»`;
        entidadId = `${actor.sucursalId}:${g.id}`;
      }
      const clave = { sucursalId: actor.sucursalId, objetivo: comando.objetivo };
      const fila = await filaDePrecioLocalDeCombinacion(tx, clave);
      const nueva = comando.precio === null ? (fila ? { precio: fila.precio, habilitado: false } : null) : { precio: comando.precio, habilitado: true };
      const cambios = cambiosPorColumna([
        { campo: "precio", antes: fila?.precio ?? null, despues: nueva?.precio ?? null },
        { campo: "habilitado", antes: fila?.habilitado ?? null, despues: nueva?.habilitado ?? null },
      ]);
      const celda = `${nombre} en «${actor.sucursalNombre}»`;
      if (nueva === null || cambios.length === 0) return exito(`El precio de ${celda} no tenía cambios.`, { huboCambio: false });
      const vioLoMismo = comando.esperado === null ? fila === null : fila !== null && fila.precio === comando.esperado.precio && fila.habilitado === comando.esperado.habilitado;
      if (!vioLoMismo) return fracaso("PRECIO_DESACTUALIZADO", `El precio de ${celda} cambió mientras lo editabas. Recargá la pantalla y volvé a hacer el cambio.`);

      await fijarPrecioLocalDeCombinacion(tx, { ...clave, precio: nueva.precio, habilitado: nueva.habilitado, ahora: actor.ahora });
      const descripcion = nueva.habilitado ? `Precio de ${celda}: ${nueva.precio}.` : `Precio de ${celda}: vuelve a regir el de la empresa.`;
      for (const c of cambios) {
        await registrarCambioAuditado(tx, {
          entidad: "PrecioLocalDeCombinacion",
          entidadId,
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
    true,
  );
}
