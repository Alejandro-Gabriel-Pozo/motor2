import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES } from "@/core/features/catalogo/productos.guard";
import type { PedidoSincronizarPrecioGrupoCarta, ResultadoSincronizarPrecioGrupoCarta } from "@/core/features/catalogo/productos.schema";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { resolverGrupoDeProducto } from "@/server/lecturas/carta/grupo-de-producto";
import { fijarPrecioVentaDeProducto } from "@/server/persistencia/catalogo/productos";

/**
 * Caso de uso «aplicar el mismo precio de venta GLOBAL a varios productos de UN mismo ítem agrupado de la carta» (el paso que ofrece `actualizarProducto` con
 * `sincronizable`; docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8; Hito 4 de la pureza, bloque 4.3, paso H4C-13 — `docs/plan-hito-4-pureza.md` §3). Es el
 * cuerpo que antes vivía en línea en la Server Action `sincronizarPrecioGrupoCarta` (`src/server/actions/catalogo/productos.ts`), movido TAL CUAL: el ítem agrupado
 * del primer producto se resuelve con la base del contexto en la sucursal activa, y solo se tocan los productos pasados si son TODOS de ese ítem; después, todo el
 * grupo en UNA transacción, con su auditoría (Task #41, M10): o quedan todos los precios con su rastro, o ninguno. Mismo permiso y misma auditoría que editar el
 * precio de cada uno a mano. La Server Action quedó como adaptador (`conPermisoDeEmpresa("producto_sincronizar_precio_carta")` →
 * `guardComandoSincronizarPrecioGrupoCarta` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * M.2 (D-3 del dueño): como sincronizar ES cambiar el precio de venta, pide además `producto_campos_sensibles`. El caso de uso tampoco la chequea: la Server Action calcula `comando.puedeEditarCamposSensibles` con el gate y
 * acá, sin él, se rechaza con `SIN_PERMISO_CAMPOS_SENSIBLES` antes de leer el ítem agrupado.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del precio y la lista (el guard).
 *
 * @contract Deja el precio de venta pedido en cada producto de la lista (todos del mismo ítem agrupado), con una fila de auditoría por producto que cambió: todo o nada.
 * @idempotency No aplica — repetir el pedido vuelve a escribir el mismo precio (sin filas de auditoría nuevas: no cambió).
 * @transaction `actor.transaccion` (READ COMMITTED): los productos se releen, se escriben y se auditan dentro; el ítem agrupado se resuelve antes con `actor.db`.
 * @sideEffects registrarCambioAuditado (Producto.precioVenta de cada producto, del anterior al nuevo), en la misma transacción. La revalidación de la carta pública
 *   la hace la Server Action.
 * @ficha permiso=producto_sincronizar_precio_carta transaccion=SIMPLE idempotencia=NO_APLICA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function sincronizarPrecioGrupoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId" | "sucursalId">,
  comando: PedidoSincronizarPrecioGrupoCarta,
): Promise<ResultadoSincronizarPrecioGrupoCarta> {
  // M.2 (D-3): sincronizar el precio es cambiar el precio de venta de varios productos a la vez, así que pide además la clave fina. Se decide antes de leer nada: quien no la tiene no se entera de cómo se agrupa la carta.
  if (!comando.puedeEditarCamposSensibles) return fracaso("SIN_PERMISO_CAMPOS_SENSIBLES", MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES);
  const { productoIds: ids, precio } = comando;
  const grupo = await resolverGrupoDeProducto(ids[0], actor.sucursalId, actor.db);
  const delGrupo = new Set(grupo ? [ids[0], ...grupo.hermanos.map((h) => h.productoId)] : []);
  if (!grupo || ids.some((id) => !delGrupo.has(id))) return fracaso("NO_MISMO_ITEM", "Esos productos no están todos en el mismo ítem agrupado de la carta.");

  // Todo el grupo en UNA transacción, con su auditoría (Task #41, M10): o quedan todos los precios con su rastro, o ninguno.
  const productos = await actor.transaccion(async (tx) => {
    const productos = await tx.producto.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, precioVenta: true }, orderBy: { nombre: "asc" } });
    for (const p of productos) {
      await fijarPrecioVentaDeProducto(tx, { id: p.id, precioVenta: precio });
      await registrarCambioAuditado(tx, {
        entidad: "Producto", entidadId: p.id, campo: "precioVenta",
        descripcion: `Producto "${p.nombre}": precio de venta`,
        valorAnterior: Number(p.precioVenta), valorNuevo: precio, actorId: actor.usuarioId,
      });
    }
    return productos;
  });
  return exito(`Precio de venta de ${productos.map((p) => `"${p.nombre}"`).join(", ")} actualizado a $${precio.toLocaleString("es-AR")} («${grupo.nombreItem}»).`, null);
}
