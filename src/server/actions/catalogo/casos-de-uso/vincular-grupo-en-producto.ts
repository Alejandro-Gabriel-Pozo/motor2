import "server-only";
import type { ComandoVincularGrupoEnProducto, ResultadoVincularGrupoEnProducto } from "@/core/features/catalogo/opciones-de-venta.schema";
import { esBaseConfigurable, rechazoDeAdmisionesDeBase, type ModoDePrecioDeMedida } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { actualizarAdmisionDeGrupo } from "@/server/persistencia/catalogo/opciones-de-venta";
import { tomarFilaDeProducto } from "@/server/persistencia/catalogo/productos";
import { fijarAdmisionDeGrupoEnTx } from "./fijar-admision-de-grupo-en-producto";
import { admisionesParaSerBase } from "./opciones-de-venta-en-tx";

/**
 * Caso de uso «QUITAR un grupo de opciones de un producto, o VOLVER A VINCULARLO» (OPCIONES-LIMPIEZA; decisión del dueño, 2026-10-14): el botón «Quitar de este producto» y su
 * «Deshacer». Quitar es `ProductoAdmiteGrupo.activo = false` (la base no tiene DELETE para la app): el producto deja de ofrecer el grupo en la venta y en la carta, y la fila con
 * lo que admitía de cada opción (topes, precios propios) se conserva tal cual, así que volver a vincular lo deja como estaba. Es «llevar al estado»: no lleva la versión de la
 * pantalla, para que el «Deshacer» funcione aunque la pantalla ya se haya refrescado; la versión se lee DENTRO de la transacción y va en el `where` de la escritura.
 *
 * Dentro de UNA transacción SERIALIZABLE: relee la fila (producto, grupo); sin fila → `NO_VINCULADO` (un id ajeno tampoco se ve, por la RLS). Si ya está en el estado pedido, éxito
 * sin escribir ni auditar. QUITAR valida una sola cosa (Fase 4 de la ola «precio y carta», ADR-035): si el producto se vende por opción, no puede quedar sin grupo de precio final
 * (`rechazoDeAdmisionesDeBase` con lo que queda; si no, `BASE_SIN_PRECIO_FINAL`: se vendería suelto a su precio guardado). Para eso toma PRIMERO la fila del producto (`tomarFilaDeProducto`,
 * `FOR UPDATE`, como la edición del producto que lo pasa a base: una de las dos espera a la otra). Después escribe `activo = false` con la versión leída y audita la columna. VOLVER A VINCULAR pasa por el MISMO cuerpo de la admisión (`fijarAdmisionDeGrupoEnTx`, en esta misma transacción, con lo que la fila tenía):
 * el grupo y sus opciones tienen que estar activos para la empresa, el mínimo tiene que alcanzarse y el control de precio de lista vale como al guardar el formulario.
 *
 * @contract Deja el grupo vinculado (o quitado) del producto como se pide, sin tocar lo que admitía de cada opción.
 * @idempotency Por estado — si el grupo ya está vinculado (o quitado) como se pide, éxito sin escribir ni auditar: quitar dos veces o restaurar dos veces no cambia nada.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico` (el de la admisión, por si volver a vincular crea la fila de alguna opción).
 * @sideEffects registrarCambioAuditado (`ProductoAdmiteGrupo.activo`, con el antes y el después; al volver a vincular, la auditoría por columna de la admisión), con el mismo `tx`.
 * @ficha permiso=producto_opciones_admitidas transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function vincularGrupoEnProductoCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">,
  comando: ComandoVincularGrupoEnProducto
): Promise<ResultadoVincularGrupoEnProducto> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoVincularGrupoEnProducto> => {
      // Fase 4: la fila del producto, antes de leer nada (la edición que lo pasa a base la toma igual).
      await tomarFilaDeProducto(tx, comando.productoId);
      const fila = await tx.productoAdmiteGrupo.findUnique({
        where: { productoId_grupoId: { productoId: comando.productoId, grupoId: comando.grupoId } },
        select: { id: true, orden: true, cantidadMinima: true, cantidadMaxima: true, modoPrecio: true, activo: true, version: true, producto: { select: { nombre: true, modoDeVenta: true } }, grupo: { select: { nombre: true } } },
      });
      if (!fila) return fracaso("NO_VINCULADO", "No se encontró ese grupo en este producto: si nunca lo tuvo, agregalo desde «Agregar grupo».");
      const producto = fila.producto.nombre;
      const grupo = fila.grupo.nombre;
      if (fila.activo === comando.vinculado) {
        return exito(comando.vinculado ? `«${grupo}» ya estaba en «${producto}».` : `«${grupo}» ya estaba quitado de «${producto}».`, { huboCambio: false });
      }

      const actual = { orden: fila.orden, cantidadMinima: fila.cantidadMinima, cantidadMaxima: fila.cantidadMaxima, modoPrecio: fila.modoPrecio as ModoDePrecioDeMedida | null };
      if (!comando.vinculado) {
        // Solo se frena si es ESTE grupo el que la deja sin precio final (una base que ya no cumple, por un grupo archivado —D-4—, puede seguir quitando otros grupos).
        const dejaSinPrecioFinal = async () =>
          rechazoDeAdmisionesDeBase(await admisionesParaSerBase(tx, comando.productoId, { exceptoGrupoId: comando.grupoId })) !== null &&
          rechazoDeAdmisionesDeBase(await admisionesParaSerBase(tx, comando.productoId)) === null;
        if (esBaseConfigurable(fila.producto.modoDeVenta) && (await dejaSinPrecioFinal())) {
          return fracaso(
            "BASE_SIN_PRECIO_FINAL",
            `«${grupo}» tiene el precio final de cada opción de «${producto}», que se vende por opción: sin él se vendería a un precio que no se cobra. Cambiá primero «¿Cómo se vende?» a Directo.`,
          );
        }
        const tocadas = await actualizarAdmisionDeGrupo(tx, { id: fila.id, versionEsperada: fila.version, fila: { ...actual, activo: false }, ahora: actor.ahora });
        if (tocadas === 0) return fracaso("VERSION_DESACTUALIZADA", `Lo que admite «${producto}» de «${grupo}» cambió mientras lo mirabas. Recargá la pantalla y volvé a intentarlo.`);
        await registrarCambioAuditado(tx, {
          entidad: "ProductoAdmiteGrupo",
          entidadId: fila.id,
          campo: "activo",
          descripcion: `«${grupo}» se quitó de «${producto}».`,
          valorAnterior: true,
          valorNuevo: false,
          actorId: actor.usuarioId,
          sucursalId: null,
        });
        return exito(`«${grupo}» se quitó de «${producto}». No se borró nada: lo que admitía queda guardado.`, { huboCambio: true });
      }

      const r = await fijarAdmisionDeGrupoEnTx(tx, actor, { productoId: comando.productoId, grupoId: comando.grupoId, versionEsperada: fila.version, ...actual, activo: true, opciones: [] });
      if (!r.ok) return r;
      return exito(`«${grupo}» volvió a «${producto}», como estaba.${r.datos.avisos.length ? ` ${r.datos.avisos.join(" ")}` : ""}`, { huboCambio: true });
    },
    undefined,
    undefined,
    true
  );
}
