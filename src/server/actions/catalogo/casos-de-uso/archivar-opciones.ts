import "server-only";
import type { ComandoArchivarOpciones, ResultadoArchivarOpciones } from "@/core/features/catalogo/opciones-de-venta.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { fijarActivaDeOpcionDeGrupo, fijarActivoDeGrupoDeOpciones } from "@/server/persistencia/catalogo/opciones-de-venta";
import { admisionesActivasDelGrupo, avisoDeProductosAfectados, cargarGrupoEnTx, idsDeProductosSinPoderVenderse, opcionesActivasDelGrupo } from "./opciones-de-venta-en-tx";

/** Una escritura del lote no encontró la versión que se leyó en la misma transacción: se LANZA para que la transacción entera se deshaga (todo o nada) y se devuelve como fracaso afuera. */
class LoteDesactualizado extends Error {
  constructor() {
    super("Una fila del lote cambió de versión dentro de la transacción.");
    this.name = "LoteDesactualizado";
  }
}

const MENSAJE_DESACTUALIZADO = "Algo de lo que elegiste cambió mientras lo mirabas: otra persona lo guardó antes. Recargá la pantalla y volvé a intentarlo.";

/** «archivado», «archivada», «archivados»… según el elemento (un grupo es masculino; una opción, femenina) y la acción. */
function participio(archivar: boolean, femenino: boolean): string {
  return `${archivar ? "archivad" : "restaurad"}${femenino ? "a" : "o"}`;
}

/** «2 grupos y 3 opciones», «1 grupo», «4 opciones». */
function cuantos(grupos: number, opciones: number): string {
  const partes = [grupos === 0 ? "" : grupos === 1 ? "1 grupo" : `${grupos} grupos`, opciones === 0 ? "" : opciones === 1 ? "1 opción" : `${opciones} opciones`].filter(Boolean);
  return partes.join(" y ");
}

/**
 * Caso de uso «ARCHIVAR o RESTAURAR grupos y opciones de venta» (OPCIONES-LIMPIEZA; decisión del dueño, 2026-10-14). Un grupo o una opción archivados dejan de ofrecerse en la venta,
 * la carta y los listados activos por la vía que ya existe (`GrupoDeOpciones.activo`, `OpcionDeGrupo.activa`: la lectura de la venta y la de la carta ya los filtran), pero se
 * conservan y se restauran con el mismo pedido y `archivar = false` (el «Deshacer»). Lo YA VENDIDO no cambia nunca: la foto de cada línea (`OpcionElegidaEnLinea`) es de solo
 * agregar y guarda el nombre, el tipo, la versión y el importe de lo que se vendió. Sirve para un elemento suelto (el botón «Archivar») y para un lote de «Limpiar».
 *
 * TODO O NADA, dentro de UNA transacción SERIALIZABLE: relee cada grupo y cada opción (un id que no existe o es de otra empresa no se ve con la RLS: el lote entero se rechaza con
 * `NO_ENCONTRADO` sin tocar nada); escribe solo los que cambian de estado, cada uno con la `version` LEÍDA en el `where` (sube en 1, así una edición abierta en otra pestaña da
 * «cambió mientras lo editabas») y una fila de auditoría por elemento con el antes y el después. Si una escritura no encuentra su versión, LANZA y la transacción se deshace
 * entera. Dos lotes a la vez sobre los mismos elementos se ordenan (SERIALIZABLE aborta a uno y su reintento relee: ve los elementos ya archivados y no los vuelve a escribir).
 * D-4: archivar un grupo obligatorio (o la última opción que deja un mínimo inalcanzable) no se bloquea; el mensaje avisa a cuántos productos deja sin poder venderse.
 *
 * @contract Deja cada grupo y cada opción del lote archivados (o restaurados) y su versión + 1 si cambió; los que ya estaban así quedan igual.
 * @idempotency Por estado — un elemento que ya está en el estado pedido no se escribe ni se audita: archivar dos veces, o restaurar dos veces, da éxito sin cambios.
 * @transaction conTransaccionSerializable (SERIALIZABLE): todo el lote o nada; una escritura que no encuentra su versión deshace la transacción entera.
 * @sideEffects registrarCambioAuditado (una fila por elemento que cambió: `GrupoDeOpciones.activo` u `OpcionDeGrupo.activa`, con el antes y el después), con el mismo `tx`.
 * @ficha permiso=opciones_definir transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function archivarOpcionesCasoDeUso(actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">, comando: ComandoArchivarOpciones): Promise<ResultadoArchivarOpciones> {
  try {
    return await conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoArchivarOpciones> => {
      const grupos = await tx.grupoDeOpciones.findMany({ where: { id: { in: comando.grupoIds } }, orderBy: { nombre: "asc" }, select: { id: true, nombre: true, activo: true, version: true } });
      const opciones = await tx.opcionDeGrupo.findMany({
        where: { id: { in: comando.opcionIds } },
        orderBy: [{ grupoId: "asc" }, { orden: "asc" }],
        select: { id: true, nombre: true, activa: true, version: true, grupoId: true, grupo: { select: { nombre: true, activo: true } } },
      });
      if (grupos.length !== comando.grupoIds.length || opciones.length !== comando.opcionIds.length) {
        return fracaso("NO_ENCONTRADO", "No se encontró alguno de los grupos u opciones elegidos: recargá la pantalla. No se cambió nada.");
      }

      const activo = !comando.archivar;
      const gruposQueCambian = grupos.filter((g) => g.activo !== activo);
      const opcionesQueCambian = opciones.filter((o) => o.activa !== activo);
      if (gruposQueCambian.length + opcionesQueCambian.length === 0) {
        const estado = (femenino: boolean) => (comando.archivar ? participio(true, femenino) : "en uso");
        const mensaje =
          grupos.length + opciones.length === 1
            ? grupos[0]
              ? `El grupo «${grupos[0].nombre}» ya estaba ${estado(false)}.`
              : `La opción «${opciones[0]!.nombre}» ya estaba ${estado(true)}.`
            : `Ya estaban todos ${comando.archivar ? "archivados" : "en uso"}.`;
        return exito(mensaje, { cambiados: 0, productosAfectados: 0 });
      }

      for (const g of gruposQueCambian) {
        if ((await fijarActivoDeGrupoDeOpciones(tx, { id: g.id, versionEsperada: g.version, activo, ahora: actor.ahora })) === 0) throw new LoteDesactualizado();
        await registrarCambioAuditado(tx, {
          entidad: "GrupoDeOpciones",
          entidadId: g.id,
          campo: "activo",
          descripcion: `Grupo de opciones «${g.nombre}»: ${participio(comando.archivar, false)}.`,
          valorAnterior: g.activo,
          valorNuevo: activo,
          actorId: actor.usuarioId,
          sucursalId: null,
        });
      }
      for (const o of opcionesQueCambian) {
        if ((await fijarActivaDeOpcionDeGrupo(tx, { id: o.id, versionEsperada: o.version, activa: activo, ahora: actor.ahora })) === 0) throw new LoteDesactualizado();
        await registrarCambioAuditado(tx, {
          entidad: "OpcionDeGrupo",
          entidadId: o.id,
          campo: "activa",
          descripcion: `Opción «${o.nombre}» de «${o.grupo.nombre}»: ${participio(comando.archivar, true)}.`,
          valorAnterior: o.activa,
          valorNuevo: activo,
          actorId: actor.usuarioId,
          sucursalId: null,
        });
      }

      // D-4: al archivar, los productos que se quedan sin poder venderse (cada uno una vez, aunque el lote toque varios de sus grupos). Se lee DESPUÉS de escribir, en la misma transacción.
      let afectados = 0;
      if (comando.archivar) {
        const tocados = [...new Set([...gruposQueCambian.map((g) => g.id), ...opcionesQueCambian.map((o) => o.grupoId)])];
        const productos = new Set<string>();
        for (const grupoId of tocados) {
          const grupo = (await cargarGrupoEnTx(tx, grupoId))!;
          for (const p of idsDeProductosSinPoderVenderse(grupo, await admisionesActivasDelGrupo(tx, grupoId), await opcionesActivasDelGrupo(tx, grupoId))) productos.add(p);
        }
        afectados = productos.size;
      }

      // Restaurar una opción de un grupo que sigue archivado no la vuelve a ofrecer: se avisa.
      const deGrupoArchivado = activo ? opcionesQueCambian.filter((o) => !o.grupo.activo && !gruposQueCambian.some((g) => g.id === o.grupoId)) : [];
      const avisoDelGrupo = deGrupoArchivado.length > 0 ? ` Ojo: «${deGrupoArchivado[0]!.grupo.nombre}» sigue archivado; restauralo para que se vuelva a ofrecer.` : "";
      const lugar = comando.archivar ? " Se puede restaurar desde «Archivados»." : "";
      const primero = gruposQueCambian.length + opcionesQueCambian.length === 1
        ? gruposQueCambian[0]
          ? `Grupo «${gruposQueCambian[0].nombre}» ${participio(comando.archivar, false)}.`
          : `Opción «${opcionesQueCambian[0]!.nombre}» ${participio(comando.archivar, true)}.`
        : `${comando.archivar ? "Archivados" : "Restaurados"}: ${cuantos(gruposQueCambian.length, opcionesQueCambian.length)}.`;
      return exito(`${primero}${lugar}${avisoDelGrupo}${avisoDeProductosAfectados(afectados)}`, { cambiados: gruposQueCambian.length + opcionesQueCambian.length, productosAfectados: afectados });
    });
  } catch (e) {
    if (e instanceof LoteDesactualizado) return fracaso("VERSION_DESACTUALIZADA", MENSAJE_DESACTUALIZADO);
    throw e;
  }
}
