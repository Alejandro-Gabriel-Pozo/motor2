import "server-only";
import type { ComandoGuardarCombinacion, ResultadoGuardarCombinacion } from "@/core/features/catalogo/combinaciones.schema";
import { cambiosPorColumna } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarCombinacionEnTx, cargarProductoConEjesEnTx } from "@/server/lecturas/catalogo/combinaciones";
import { cambiarCombinacion, crearCombinacion } from "@/server/persistencia/catalogo/combinaciones";

/**
 * Caso de uso «guardar una COMBINACIÓN del producto» (GO-3b, ADR-032, frente A, paso AB4): la opción del eje 1 y, si hay, la del eje 2, con su estado (`activa`: false = esa combinación no se vende,
 * «el flat white chico no existe») y su precio: PROPIO (de 0,01 o más), de una TARIFA compartida (un grupo de precio activo) o ninguno (rige el precio aditivo de siempre). Es una sobrescritura
 * dispersa: solo existe la fila de lo que se sale de la regla. La identidad (producto y opciones) no cambia nunca; la combinación no se borra (se desactiva).
 *
 * Dentro de UNA transacción SERIALIZABLE: el producto con sus ejes (`SIN_EJES` si no declaró); cada opción pedida es del grupo de su eje, el producto la admite (activa) y no es la «ninguna», y la del
 * eje 2 viene si y solo si hay eje 2 (`COMBINACION_INVALIDA`); la tarifa existe y está activa; control OPTIMISTA (`versionEsperada` 0 = nueva: si ya existe, `VERSION_DESACTUALIZADA`; si no, la de la
 * fila, con `UPDATE … WHERE version = esperada`). Si no cambia nada, éxito sin escribir. Auditoría por columna (`CombinacionDeProducto`: `activa`, `precio`, `grupoDePrecioId`). Write skew con
 * «desactivar la tarifa» (cada una lee lo que la otra escribe) y con «cambiar los ejes»: SERIALIZABLE aborta a una y su reintento relee.
 *
 * @contract Deja la combinación con el estado y el precio pedidos, con su auditoría, si es válida y nadie la cambió desde la versión vista.
 * @idempotency Optimista — la versión esperada se compara dentro de la transacción; el mismo pedido repetido no escribe ni audita; dos altas a la vez de la misma combinación dejan una (el único por expresión y el reintento, que ve la otra: `VERSION_DESACTUALIZADA`).
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: las lecturas que deciden, la escritura y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`CombinacionDeProducto`: `activa`, `precio`, `grupoDePrecioId`), con el mismo `tx`.
 * @ficha permiso=producto_opciones_admitidas transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarCombinacionDeProductoCasoDeUso(actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">, comando: ComandoGuardarCombinacion): Promise<ResultadoGuardarCombinacion> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoGuardarCombinacion> => {
      const producto = await cargarProductoConEjesEnTx(tx, comando.productoId);
      if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
      const { eje1, eje2 } = producto.ejes;
      if (eje1 === null) return fracaso("SIN_EJES", `«${producto.nombre}» no tiene ejes de combinación: elegí primero sus ejes (por ejemplo, el tamaño y la leche).`);
      const invalida = fracaso("COMBINACION_INVALIDA", `Esas opciones no forman una combinación de «${producto.nombre}».`);
      const opcionDelEje = (grupoId: string, opcionId: string) => {
        const g = producto.grupos.find((x) => x.grupoId === grupoId);
        const o = g?.opcionesAdmitidas.get(opcionId);
        return g && g.activo && o && !o.esNinguna ? o.nombre : null;
      };
      const nombre1 = opcionDelEje(eje1, comando.opcionEje1Id);
      if (nombre1 === null) return invalida;
      let nombre2: string | null = null;
      if (eje2 === null) {
        if (comando.opcionEje2Id !== null) return invalida;
      } else {
        if (comando.opcionEje2Id === null) return invalida;
        nombre2 = opcionDelEje(eje2, comando.opcionEje2Id);
        if (nombre2 === null) return invalida;
      }
      if (comando.grupoDePrecioId !== null) {
        const grupo = await tx.grupoDePrecio.findFirst({ where: { id: comando.grupoDePrecioId }, select: { activo: true, nombre: true } });
        if (!grupo) return fracaso("GRUPO_DE_PRECIO_NO_ENCONTRADO", "No se encontró esa tarifa.");
        if (!grupo.activo) return fracaso("GRUPO_DE_PRECIO_INACTIVO", `La tarifa «${grupo.nombre}» está desactivada: activala o elegí otra.`);
      }

      const nombre = `«${[producto.nombre, nombre1, nombre2].filter(Boolean).join(" · ")}»`;
      const desactualizada = fracaso("VERSION_DESACTUALIZADA", `Otra persona cambió ${nombre} mientras la editabas: recargá la pantalla y volvé a intentar.`);
      const existente = await cargarCombinacionEnTx(tx, { productoId: producto.id, opcionEje1Id: comando.opcionEje1Id, opcionEje2Id: comando.opcionEje2Id });
      const despues = { activa: comando.activa, precio: comando.precio, grupoDePrecioId: comando.grupoDePrecioId };
      if (existente === null ? comando.versionEsperada !== 0 : existente.version !== comando.versionEsperada) return desactualizada;
      const antes = existente ? { activa: existente.activa, precio: existente.precio === null ? null : Number(existente.precio), grupoDePrecioId: existente.grupoDePrecioId } : null;
      const cambios = cambiosPorColumna([
        { campo: "activa", antes: antes?.activa ?? null, despues: despues.activa },
        { campo: "precio", antes: antes?.precio ?? null, despues: despues.precio },
        { campo: "grupoDePrecioId", antes: antes?.grupoDePrecioId ?? null, despues: despues.grupoDePrecioId },
      ]);
      if (existente && cambios.length === 0) return exito(`${nombre} no tenía cambios.`, { combinacionId: existente.id, huboCambio: false });

      let combinacionId: string;
      if (existente) {
        if ((await cambiarCombinacion(tx, { id: existente.id, versionEsperada: comando.versionEsperada, ...despues, ahora: actor.ahora })) === 0) return desactualizada;
        combinacionId = existente.id;
      } else {
        combinacionId = (await crearCombinacion(tx, { productoId: producto.id, opcionEje1Id: comando.opcionEje1Id, opcionEje2Id: comando.opcionEje2Id, ...despues, ahora: actor.ahora })).id;
      }
      for (const c of cambios) {
        await registrarCambioAuditado(tx, {
          entidad: "CombinacionDeProducto",
          entidadId: combinacionId,
          campo: c.campo,
          descripcion: `Combinación ${nombre}`,
          valorAnterior: c.antes,
          valorNuevo: c.despues,
          actorId: actor.usuarioId,
        });
      }
      return exito(`Combinación ${nombre} guardada.`, { combinacionId, huboCambio: true });
    },
    undefined,
    undefined,
    true,
  );
}
