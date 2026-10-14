import "server-only";
import type { ComandoFijarEjesDeProducto, ResultadoFijarEjesDeProducto } from "@/core/features/catalogo/combinaciones.schema";
import { validarEjesDeCombinacion } from "@/core/opciones/public";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { cargarProductoConEjesEnTx, tieneCombinaciones } from "@/server/lecturas/catalogo/combinaciones";
import { fijarEjeDeGrupoAdmitido } from "@/server/persistencia/catalogo/combinaciones";

/**
 * Caso de uso «estos grupos son los EJES de las combinaciones del producto» (GO-3b, ADR-032, frente A, paso AB4). Un eje es un grupo que el producto admite (activo), MEDIDA o VARIANTE, que elige
 * SIEMPRE exactamente una opción (mínimo = máximo = 1 efectivos), con a lo sumo dos ejes y a lo sumo una MEDIDA entre ellos (`validarEjesDeCombinacion`, `core/opciones`).
 *
 * Dentro de UNA transacción SERIALIZABLE: lee el producto con sus grupos admitidos; si los ejes pedidos son los que ya tiene, éxito sin escribir. Si cambian y el producto YA TIENE combinaciones,
 * `EJES_CON_COMBINACIONES` (los ejes son inmutables mientras exista una: una combinación nombra opciones de esos ejes). Si no, valida los ejes nuevos y escribe `ejeDeCombinacion` (y sube la versión)
 * de cada grupo que cambia, con su auditoría (`ProductoAdmiteGrupo`, `ejeDeCombinacion`). Write skew con «guardar una combinación»: cada una lee lo que la otra escribe (los ejes y las
 * combinaciones del producto), así que SERIALIZABLE aborta a una y su reintento relee.
 *
 * @contract Deja los ejes pedidos en el producto, con su auditoría, si son válidos y el producto no tiene combinaciones.
 * @idempotency Por estado — si los ejes ya son esos no se escribe ni se audita.
 * @transaction conTransaccionSerializable (SERIALIZABLE): las lecturas que deciden, la escritura y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (`ProductoAdmiteGrupo`, `ejeDeCombinacion`), con el mismo `tx`.
 * @ficha permiso=producto_opciones_admitidas transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function fijarEjesDeCombinacionCasoDeUso(actor: Pick<ContextoDeAccion, "usuarioId" | "transaccion" | "ahora">, comando: ComandoFijarEjesDeProducto): Promise<ResultadoFijarEjesDeProducto> {
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoFijarEjesDeProducto> => {
    const producto = await cargarProductoConEjesEnTx(tx, comando.productoId);
    if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
    if (producto.ejes.eje1 === comando.eje1GrupoId && producto.ejes.eje2 === comando.eje2GrupoId) return exito(`Los ejes de «${producto.nombre}» ya eran esos.`, { huboCambio: false });
    if (await tieneCombinaciones(tx, producto.id)) {
      return fracaso("EJES_CON_COMBINACIONES", `«${producto.nombre}» ya tiene combinaciones cargadas: sus ejes no se pueden cambiar (desactivá las combinaciones que no se usen).`);
    }
    const pedidos = [comando.eje1GrupoId, comando.eje2GrupoId].filter((g): g is string => g !== null);
    for (const grupoId of pedidos) {
      const g = producto.grupos.find((x) => x.grupoId === grupoId);
      if (!g || !g.activo) return fracaso("EJES_INVALIDOS", `«${producto.nombre}» no admite ese grupo de opciones (o está desactivado): no puede ser un eje.`);
    }
    const ejeDe = (grupoId: string) => (grupoId === comando.eje1GrupoId ? 1 : grupoId === comando.eje2GrupoId ? 2 : null);
    const validados = validarEjesDeCombinacion(producto.grupos.filter((g) => ejeDe(g.grupoId) !== null).map((g) => ({ ...g, eje: ejeDe(g.grupoId) })));
    if (!validados.ok) return fracaso(validados.codigo, validados.mensaje);

    for (const g of producto.grupos) {
      const nuevo = ejeDe(g.grupoId);
      if (nuevo === g.eje) continue;
      await fijarEjeDeGrupoAdmitido(tx, { productoId: producto.id, grupoId: g.grupoId, eje: nuevo, ahora: actor.ahora });
      await registrarCambioAuditado(tx, {
        entidad: "ProductoAdmiteGrupo",
        entidadId: g.admiteId,
        campo: "ejeDeCombinacion",
        descripcion: `«${producto.nombre}»: «${g.nombre}» ${nuevo === null ? "deja de ser" : `pasa a ser el eje ${nuevo} de`} sus combinaciones`,
        valorAnterior: g.eje,
        valorNuevo: nuevo,
        actorId: actor.usuarioId,
      });
    }
    return exito(`Ejes de las combinaciones de «${producto.nombre}» guardados.`, { huboCambio: true });
  });
}
