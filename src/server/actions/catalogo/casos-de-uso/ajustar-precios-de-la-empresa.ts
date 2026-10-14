import "server-only";
import { aCentavos, precioAjustado } from "@/core/carta/public";
import { MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES } from "@/core/features/catalogo/productos.guard";
import type { ComandoAjustarPreciosDeLaEmpresa, ResultadoAjustarPreciosDeLaEmpresa } from "@/core/features/carta/mantenimiento.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { fijarPrecioVentaDeProducto } from "@/server/persistencia/catalogo/productos";

/**
 * Caso de uso «Precios» de la carta, variante «En toda la empresa» (CARTA-MANT F4; ADR-034; decisión del dueño 2026-10-14): ajusta el precio de LISTA de la empresa (`Producto.precioVenta`) de una
 * sección entera o de un producto, desde la carta de una sucursal. Ese precio rige en TODAS las sucursales que no tienen un precio local propio: por eso la pantalla lo avisa con la lista de sucursales y
 * pide una casilla de confirmación, y acá se vuelve a exigir (`confirmado`, nunca solo en la interfaz). La Server Action pide `producto_editar` y calcula `producto_campos_sensibles` (las dos claves de
 * editar el precio en Catálogo); sin la segunda, `SIN_PERMISO_CAMPOS_SENSIBLES` antes de leer nada.
 *
 * Dentro de UNA transacción SERIALIZABLE, sin escribir nada hasta el final: cada producto existe y es de venta, y su precio de lista sigue siendo el `precioVisto` de la vista previa (si alguno
 * cambió, `PRECIO_DESACTUALIZADO` y no se cambia ninguno); el precio nuevo sale de la regla única (`precioAjustado`, decimal exacto en centavos); los que quedan igual no se tocan; cada uno que cambia,
 * con su auditoría (`Producto.precioVenta`, del anterior al nuevo), que dice además en qué sucursales activas de la empresa cambió el precio de lista. Repetir el mismo pedido no lo aplica dos veces
 * (los precios ya no son los vistos).
 *
 * @contract Deja el precio de lista de cada producto pedido en el precio ajustado, con su auditoría, si se confirmó, si quien lo pide tiene la clave fina y si todos siguen en el precio visto; si no, no cambia ninguno.
 * @idempotency Por estado — el precio visto arbitra: un reintento del mismo pedido ya no coincide; un producto que ya queda igual no se escribe.
 * @transaction conTransaccionSerializable (SERIALIZABLE): las lecturas que deciden, las escrituras y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (Producto.precioVenta de cada producto que cambia, con las sucursales en la descripción), con el mismo `tx`. La revalidación de la carta pública la hace la Server Action.
 * @ficha permiso=producto_editar transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function ajustarPreciosDeLaEmpresaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalNombre" | "transaccion">,
  comando: ComandoAjustarPreciosDeLaEmpresa,
): Promise<ResultadoAjustarPreciosDeLaEmpresa> {
  if (!comando.puedeEditarCamposSensibles) return fracaso("SIN_PERMISO_CAMPOS_SENSIBLES", MENSAJE_SIN_PERMISO_CAMPOS_SENSIBLES);
  if (!comando.confirmado) return fracaso("FALTA_CONFIRMAR", "Para cambiar el precio en toda la empresa hay que confirmar que se modifica en todas las sucursales.");
  const items = [...comando.items].sort((a, b) => (a.productoId < b.productoId ? -1 : a.productoId > b.productoId ? 1 : 0));
  return conTransaccionSerializable(actor.transaccion, async (tx): Promise<ResultadoAjustarPreciosDeLaEmpresa> => {
    const [productos, sucursales] = await Promise.all([
      tx.producto.findMany({ where: { id: { in: items.map((i) => i.productoId) } }, select: { id: true, nombre: true, tipo: true, precioVenta: true } }),
      tx.sucursal.findMany({ where: { activo: true }, select: { nombre: true }, orderBy: { nombre: "asc" } }),
    ]);
    const porId = new Map(productos.map((p) => [p.id, p]));
    const aEscribir: { id: string; nombre: string; antes: string; nuevo: string }[] = [];
    for (const item of items) {
      const p = porId.get(item.productoId);
      if (!p) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró uno de los productos: recargá la pantalla.");
      if (p.tipo !== "PV") return fracaso("NO_ES_PV", `«${p.nombre}» no es un producto de venta.`);
      const lista = p.precioVenta.toFixed(2);
      if (aCentavos(lista) !== aCentavos(item.precioVisto)) {
        return fracaso("PRECIO_DESACTUALIZADO", `El precio de la empresa de «${p.nombre}» cambió mientras mirabas (ahora es $${lista.replace(".", ",")}): no se cambió ninguno. Volvé a mirar la vista previa.`);
      }
      const nuevo = precioAjustado(lista, comando.ajuste);
      if (aCentavos(nuevo) !== aCentavos(lista)) aEscribir.push({ id: p.id, nombre: p.nombre, antes: lista, nuevo });
    }
    const donde = sucursales.map((s) => `«${s.nombre}»`).join(", ");
    for (const x of aEscribir) {
      await fijarPrecioVentaDeProducto(tx, { id: x.id, precioVenta: Number(x.nuevo) });
      await registrarCambioAuditado(tx, {
        entidad: "Producto",
        entidadId: x.id,
        campo: "precioVenta",
        descripcion: `Producto "${x.nombre}": precio de venta de la empresa, desde la carta de «${actor.sucursalNombre}»; cambia en las sucursales sin precio local propio de: ${donde}`,
        valorAnterior: Number(x.antes),
        valorNuevo: Number(x.nuevo),
        actorId: actor.usuarioId,
      });
    }
    const n = aEscribir.length;
    return exito(n === 0 ? "Los precios de la empresa ya eran esos: no cambió nada." : `${n === 1 ? `«${aEscribir[0]!.nombre}»: precio nuevo` : `${n} precios nuevos`} en toda la empresa.`, { cambiados: n });
  });
}
