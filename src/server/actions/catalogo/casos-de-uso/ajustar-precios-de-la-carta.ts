import "server-only";
import { aCentavos, precioAjustado, precioDeCarta } from "@/core/carta/public";
import type { ComandoAjustarPreciosDeLaCarta, ResultadoAjustarPreciosDeLaCarta } from "@/core/features/carta/mantenimiento.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import type { ContextoDeAccion } from "@/server/actions/tipos";
import { precioLocalActivoEn, preciosLocalesVigentes } from "@/server/lecturas/catalogo/precio-local";
import { guardarPrecioLocalEnTx } from "./guardar-precio-local-en-tx";

/**
 * Caso de uso «Precios» de la carta (CARTA-MANT F4; ADR-034; decisión del dueño 2026-10-14: es lo que hace «Precios» por defecto): ajusta el PRECIO LOCAL de la
 * sucursal ACTIVA (`PrecioLocalProducto`, el mismo que se carga a mano en «Precio local», con su paso compartido `guardarPrecioLocalEnTx` y su auditoría), nunca el precio de lista de la empresa.
 * Requiere que la sucursal tenga prendido el precio local (si no, lo que rige es el de lista y se cambia en Catálogo: `PRECIO_LOCAL_APAGADO`).
 *
 * Dentro de UNA transacción SERIALIZABLE, sin escribir nada hasta el final:
 *  1. la capacidad `precio_local` de la sucursal (el lector único, `precioLocalActivoEn`);
 *  2. cada producto: existe y es de venta; su precio de ESTA sucursal hoy (`preciosLocalesVigentes` + `precioDeCarta`, la misma lectura que la carta) tiene que ser el `precioVisto` de la vista
 *     previa: si alguno cambió, `PRECIO_DESACTUALIZADO` y no se aplica ninguno (control de concurrencia sin columna de versión);
 *  3. el precio nuevo con la regla única (`precioAjustado`, decimal exacto en centavos, sin redondeo en la pantalla); los que ya quedan igual no se tocan;
 *  4. cada precio nuevo como precio local habilitado, con su auditoría (`PrecioLocalProducto`, `precio` y `habilitado`), en la misma transacción.
 * Repetir el mismo pedido NO aplica el ajuste dos veces: después del primero los precios ya no son los vistos (`PRECIO_DESACTUALIZADO`).
 *
 * @contract Deja el precio local de cada producto pedido en el precio ajustado (en la sucursal activa), con su auditoría, si todos siguen en el precio que mostró la vista previa; si no, no cambia ninguno.
 * @idempotency Por estado — el precio visto arbitra: un reintento del mismo pedido ya no coincide y no se aplica dos veces; un producto que ya queda igual no se escribe.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: las lecturas que deciden, las escrituras y la auditoría, juntas.
 * @sideEffects registrarCambioAuditado (PrecioLocalProducto.precio y .habilitado de cada producto), en la misma transacción, por el paso compartido. La revalidación de la carta pública la hace la Server Action.
 * @ficha permiso=precio_local transaccion=SERIALIZABLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function ajustarPreciosDeLaCartaCasoDeUso(
  actor: Pick<ContextoDeAccion, "usuarioId" | "sucursalId" | "sucursalNombre" | "transaccion">,
  comando: ComandoAjustarPreciosDeLaCarta,
): Promise<ResultadoAjustarPreciosDeLaCarta> {
  const items = [...comando.items].sort((a, b) => (a.productoId < b.productoId ? -1 : a.productoId > b.productoId ? 1 : 0));
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoAjustarPreciosDeLaCarta> => {
      const activo = await precioLocalActivoEn(actor.sucursalId, tx);
      if (!activo) {
        return fracaso("PRECIO_LOCAL_APAGADO", `«${actor.sucursalNombre}» no tiene prendido el precio local: rige el precio de lista de la empresa, que se cambia en Catálogo.`);
      }
      const ids = items.map((i) => i.productoId);
      const [productos, locales] = await Promise.all([
        tx.producto.findMany({ where: { id: { in: ids } }, select: { id: true, nombre: true, tipo: true, precioVenta: true } }),
        preciosLocalesVigentes(actor.sucursalId, tx, ids, activo),
      ]);
      const porId = new Map(productos.map((p) => [p.id, p]));
      const aEscribir: { producto: { id: string; nombre: string }; nuevo: string }[] = [];
      for (const item of items) {
        const p = porId.get(item.productoId);
        if (!p) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró uno de los productos: recargá la pantalla.");
        if (p.tipo !== "PV") return fracaso("NO_ES_PV", `«${p.nombre}» no es un producto de venta.`);
        // El precio de esta sucursal hoy, la misma lectura que la carta; al centavo, en texto (sin pasar por la coma flotante para comparar).
        const hoy = precioDeCarta(Number(p.precioVenta), locales.get(p.id)).toFixed(2);
        if (aCentavos(hoy) !== aCentavos(item.precioVisto)) {
          return fracaso("PRECIO_DESACTUALIZADO", `El precio de «${p.nombre}» cambió mientras mirabas (ahora es $${hoy.replace(".", ",")}): no se cambió ninguno. Volvé a mirar la vista previa.`);
        }
        const nuevo = precioAjustado(hoy, comando.ajuste);
        // Si queda igual no se escribe (tampoco se crea un precio local igual al de lista: lo dejaría fijo aunque la empresa cambie el suyo).
        if (aCentavos(nuevo) !== aCentavos(hoy)) aEscribir.push({ producto: { id: p.id, nombre: p.nombre }, nuevo });
      }
      for (const x of aEscribir) await guardarPrecioLocalEnTx(tx, actor, x.producto, Number(x.nuevo), true);
      const n = aEscribir.length;
      return exito(
        n === 0 ? "Los precios ya eran esos: no cambió nada." : n === 1 && items.length === 1 ? `«${aEscribir[0]!.producto.nombre}»: precio nuevo $${Number(aEscribir[0]!.nuevo).toLocaleString("es-AR")} en «${actor.sucursalNombre}».` : `${n} precios nuevos en «${actor.sucursalNombre}».`,
        { cambiados: n },
      );
    },
    undefined,
    undefined,
    true,
  );
}
