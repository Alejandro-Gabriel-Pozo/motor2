import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { mismosCentavos } from "@/core/datos/importe";
import { esBaseConfigurable } from "@/core/opciones/public";
import { MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES } from "@/core/features/catalogo/productos.guard";
import type { PedidoSincronizarPrecioGrupoCarta, ResultadoSincronizarPrecioGrupoCarta } from "@/core/features/catalogo/productos.schema";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { exito, fracaso } from "@/core/resultado-caso";
import { resolverGrupoDeProducto } from "@/server/lecturas/carta/grupo-de-producto";
import { fijarPrecioVentaDeProducto } from "@/server/persistencia/catalogo/productos";

/**
 * Caso de uso «aplicar el mismo precio de venta GLOBAL a varios productos de UN mismo ítem agrupado de la carta» (el paso que ofrece `actualizarProducto` con
 * `sincronizable`; docs/plan-agrupacion-items-carta-2026-09-24.md, D11/M8; Hito 4 de la pureza, bloque 4.3, paso H4C-13 — `docs/plan-hito-4-pureza.md` §3). Mismo
 * permiso y misma auditoría que editar el precio de cada uno a mano. La Server Action es el adaptador (`conPermisoDeEmpresa("producto_sincronizar_precio_carta")` →
 * `guardComandoSincronizarPrecioGrupoCarta` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * M.2 (D-3 del dueño): como sincronizar ES cambiar el precio de venta, pide además `producto_campos_sensibles`. El caso de uso tampoco la chequea: la Server Action calcula `comando.puedeEditarCamposSensibles` con el gate y
 * acá, sin él, se rechaza con `SIN_PERMISO_CAMPOS_SENSIBLES` antes de leer el ítem agrupado.
 *
 * Desde la ola «precio y carta» (Fase 2, paso A5), con control del VALOR VISTO y todo dentro de UNA transacción SERIALIZABLE (antes el ítem agrupado se resolvía fuera y la escritura iba en READ
 * COMMITTED, sin comparar):
 *  1. el ítem agrupado del primer producto en la sucursal activa: solo se tocan los productos pasados si son TODOS de ese ítem (`NO_MISMO_ITEM`);
 *  2. los productos que ya tienen el precio pedido (al centavo) no se tocan; para los demás, el precio de venta que mostró la pantalla (`preciosVistos`) tiene que ser el guardado: si alguno
 *     cambió (o la pantalla no lo mandó), `PRECIO_DESACTUALIZADO` y NO se cambia ninguno;
 *  3. el precio y su auditoría, producto por producto en orden de nombre: o quedan todos con su rastro, o ninguno.
 * Fase 4 (ADR-035), defensa: si alguno se vende por opción (no debería estar en un ítem agrupado), `ES_BASE_CONFIGURABLE` y no se cambia ninguno.
 * Repetir el mismo «Aplicar también» es un solo cambio: la segunda vez ya están todos como se pide (éxito, mismo mensaje, sin escribir).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del precio, la lista y los precios vistos (el guard).
 *
 * @contract Deja el precio de venta pedido en cada producto de la lista (todos del mismo ítem agrupado), con una fila de auditoría por producto que cambió: todo o nada; si el precio de alguno cambió desde que se ofreció igualarlo, ninguno.
 * @idempotency Optimista — el precio de venta visto de cada producto se compara dentro de la transacción; repetir el mismo pedido no escribe ni audita, y con un precio visto viejo da `PRECIO_DESACTUALIZADO`.
 * @transaction conTransaccionSerializable (SERIALIZABLE): el ítem agrupado y los productos se leen, se comparan, se escriben y se auditan dentro.
 * @sideEffects registrarCambioAuditado (Producto.precioVenta de cada producto que cambió, del anterior al nuevo), en la misma transacción. La revalidación de la carta pública
 *   la hace la Server Action.
 * @ficha permiso=producto_sincronizar_precio_carta transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function sincronizarPrecioGrupoCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "transaccion" | "usuarioId" | "sucursalId">,
  comando: PedidoSincronizarPrecioGrupoCarta,
): Promise<ResultadoSincronizarPrecioGrupoCarta> {
  // M.2 (D-3): sincronizar el precio es cambiar el precio de venta de varios productos a la vez, así que pide además la clave fina. Se decide antes de leer nada: quien no la tiene no se entera de cómo se agrupa la carta.
  if (!comando.puedeEditarCamposSensibles) return fracaso("SIN_PERMISO_CAMPOS_SENSIBLES", MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES);
  const { productoIds: ids, precio, preciosVistos } = comando;
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoSincronizarPrecioGrupoCarta> => {
    const grupo = await resolverGrupoDeProducto(ids[0], actor.sucursalId, tx);
    const delGrupo = new Set(grupo ? [ids[0], ...grupo.hermanos.map((h) => h.productoId)] : []);
    if (!grupo || ids.some((id) => !delGrupo.has(id))) return fracaso("NO_MISMO_ITEM", "Esos productos no están todos en el mismo ítem agrupado de la carta.");

    const productos = await tx.producto.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, precioVenta: true, modoDeVenta: true }, orderBy: { nombre: "asc" } });
    // Fase 4 (ADR-035), defensa: una base no puede estar en un ítem agrupado (lo rechazan el alta en el ítem y el paso a base); si igual hay una, su precio guardado no se toca.
    const base = productos.find((p) => esBaseConfigurable(p.modoDeVenta));
    if (base) return fracaso("ES_BASE_CONFIGURABLE", `«${base.nombre}» se vende por opción: su precio guardado no se iguala (el precio final está en cada opción). Sacalo del ítem agrupado.`);
    const aCambiar: { id: string; nombre: string; anterior: number }[] = [];
    for (const p of productos) {
      const guardado = Number(p.precioVenta);
      if (mismosCentavos(guardado, precio)) continue;
      const visto = Object.prototype.hasOwnProperty.call(preciosVistos, p.id) ? preciosVistos[p.id] : undefined;
      if (visto === undefined || !mismosCentavos(guardado, visto)) {
        return fracaso(
          "PRECIO_DESACTUALIZADO",
          `El precio de venta de «${p.nombre}» cambió desde que se ofreció igualarlo (ahora es $${guardado.toLocaleString("es-AR")}): no se cambió ninguno. Recargá la pantalla y volvé a hacer el cambio.`,
        );
      }
      aCambiar.push({ id: p.id, nombre: p.nombre, anterior: guardado });
    }
    // Todo el grupo en la MISMA transacción, con su auditoría (Task #41, M10): o quedan todos los precios con su rastro, o ninguno.
    for (const p of aCambiar) {
      await fijarPrecioVentaDeProducto(tx, { id: p.id, precioVenta: precio });
      await registrarCambioAuditado(tx, {
        entidad: "Producto", entidadId: p.id, campo: "precioVenta",
        descripcion: `Producto "${p.nombre}": precio de venta`,
        valorAnterior: p.anterior, valorNuevo: precio, actorId: actor.usuarioId,
      });
    }
    return exito(`Precio de venta de ${productos.map((p) => `"${p.nombre}"`).join(", ")} actualizado a $${precio.toLocaleString("es-AR")} («${grupo.nombreItem}»).`, null);
  });
}
