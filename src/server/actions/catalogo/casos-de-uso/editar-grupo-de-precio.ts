import "server-only";
import type { ComandoEditarGrupoDePrecio, ResultadoEditarGrupoDePrecio } from "@/core/features/catalogo/combinaciones.schema";
import { cambiosPorColumna } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cambiarGrupoDePrecio } from "@/server/persistencia/catalogo/combinaciones";

/**
 * Caso de uso «editar una TARIFA compartida» (nombre, precio, activa; GO-3b, ADR-032, D-3 y D-4, paso AB4). EN EL LUGAR, con control OPTIMISTA (`version`) y auditoría por columna: si subís la tarifa
 * «mediano», cambian a la vez todas las combinaciones que la usan; lo ya cargado en una mesa se cobra al precio de cuando se cargó (queda en la línea y en su foto).
 *
 * Dentro de UNA transacción SERIALIZABLE: la tarifa (`GRUPO_DE_PRECIO_NO_ENCONTRADO`; otra empresa no se ve), la versión (`VERSION_DESACTUALIZADA`), el nombre único sin mayúsculas
 * (`NOMBRE_REPETIDO`) y, para DESACTIVARLA, que ninguna combinación ACTIVA la use (`GRUPO_DE_PRECIO_CON_MIEMBROS`: se las cambia antes; write skew con «asignar la tarifa a una combinación»: cada una
 * lee lo que la otra escribe, SERIALIZABLE aborta a una). Sin cambios, éxito sin escribir.
 *
 * @contract Deja la tarifa con los datos pedidos, con su auditoría, si nadie la cambió desde la versión vista (y, si se desactiva, si no tiene combinaciones activas).
 * @idempotency Optimista — la versión esperada se compara dentro de la transacción; el mismo pedido repetido no escribe ni audita.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico` (un nombre que choca con otro recién creado relee y rechaza): las lecturas, la escritura y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`GrupoDePrecio`: `nombre`, `precio`, `activo`), con el mismo `tx`.
 * @ficha permiso=grupos_de_precio_definir transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function editarGrupoDePrecioCasoDeUso(actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">, comando: ComandoEditarGrupoDePrecio): Promise<ResultadoEditarGrupoDePrecio> {
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoEditarGrupoDePrecio> => {
      const grupo = await tx.grupoDePrecio.findFirst({ where: { id: comando.grupoDePrecioId }, select: { id: true, nombre: true, precio: true, activo: true, version: true } });
      if (!grupo) return fracaso("GRUPO_DE_PRECIO_NO_ENCONTRADO", "No se encontró esa tarifa.");
      const desactualizada = fracaso("VERSION_DESACTUALIZADA", `Otra persona cambió la tarifa «${grupo.nombre}» mientras la editabas: recargá la pantalla y volvé a intentar.`);
      if (grupo.version !== comando.versionEsperada) return desactualizada;
      const cambios = cambiosPorColumna([
        { campo: "nombre", antes: grupo.nombre, despues: comando.nombre },
        { campo: "precio", antes: Number(grupo.precio), despues: comando.precio },
        { campo: "activo", antes: grupo.activo, despues: comando.activo },
      ]);
      if (cambios.length === 0) return exito(`La tarifa «${grupo.nombre}» no tenía cambios.`, { huboCambio: false });
      if (comando.nombre.toLowerCase() !== grupo.nombre.toLowerCase()) {
        const repetido = await tx.grupoDePrecio.findFirst({ where: { id: { not: grupo.id }, nombre: { equals: comando.nombre, mode: "insensitive" } }, select: { id: true } });
        if (repetido) return fracaso("NOMBRE_REPETIDO", `Ya hay una tarifa «${comando.nombre}».`);
      }
      if (grupo.activo && !comando.activo) {
        const miembros = await tx.combinacionDeProducto.count({ where: { grupoDePrecioId: grupo.id, activa: true } });
        if (miembros > 0) return fracaso("GRUPO_DE_PRECIO_CON_MIEMBROS", `La tarifa «${grupo.nombre}» la usan ${miembros} combinación(es) activas: cambiales el precio antes de desactivarla.`);
      }
      if ((await cambiarGrupoDePrecio(tx, { id: grupo.id, versionEsperada: comando.versionEsperada, nombre: comando.nombre, precio: comando.precio, activo: comando.activo, ahora: actor.ahora })) === 0) {
        return desactualizada;
      }
      for (const c of cambios) {
        await registrarCambioAuditado(tx, { entidad: "GrupoDePrecio", entidadId: grupo.id, campo: c.campo, descripcion: `Tarifa «${comando.nombre}»`, valorAnterior: c.antes, valorNuevo: c.despues, actorId: actor.usuarioId });
      }
      return exito(`Tarifa «${comando.nombre}» guardada.`, { huboCambio: true });
    },
    undefined,
    undefined,
    true,
  );
}
