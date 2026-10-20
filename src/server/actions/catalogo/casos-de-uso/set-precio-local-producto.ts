import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import type { ComandoSetPrecioLocalProducto, ResultadoSetPrecioLocalProducto } from "@/core/features/catalogo/precio-local.schema";
import { mismosCentavos } from "@/core/datos/importe";
import { exito, fracaso } from "@/core/resultado-caso";
import { conTransaccionSerializable } from "@/lib/transaccion-serializable";
import { leerPrecioLocal } from "@/server/persistencia/catalogo/precio-local";
import { guardarPrecioLocalEnTx } from "./guardar-precio-local-en-tx";

/**
 * Caso de uso «fijar el precio local de un producto en la sucursal activa» (Hito 4 de la pureza, bloque 4.2, paso H4C-4 — `docs/plan-hito-4-pureza.md` §3). La
 * Server Action es el adaptador (`conPermiso("precio_local")` → `guardComandoSetPrecioLocalProducto` → este caso de uso → `revalidarCartasPublicas` → y DESPUÉS
 * de revalidar, si quedó habilitado, el `sincronizable` del ítem agrupado → `aResultadoAccion`).
 *
 * Desde la ola «precio y carta» (Fase 2, paso A2), con control del VALOR VISTO, dentro de UNA transacción SERIALIZABLE (antes leía el producto fuera de la
 * transacción y el upsert pisaba sin comparar: dos personas con la pantalla abierta se pisaban en silencio):
 *  1. el producto existe («No se encontró el producto.»);
 *  2. la fila actual del precio local en la sucursal (`leerPrecioLocal`); si ya está como se pide (mismo precio al centavo y mismo `habilitado`), éxito SIN escribir
 *     (el mismo pedido repetido: un solo cambio, con el mismo mensaje de siempre);
 *  3. si no, lo que vio la pantalla (`esperado`: la fila como estaba, o «no había») tiene que ser lo que hay; si otra persona lo cambió, `PRECIO_DESACTUALIZADO`
 *     sin escribir (la tabla no tiene `version`: se compara el valor, como `fijar-precio-local-de-opcion`);
 *  4. el paso compartido `guardarPrecioLocalEnTx` escribe el precio y sus dos filas de auditoría, en la misma transacción.
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos ni el formato del precio (el guard).
 *
 * @contract Deja el precio local (y si está habilitado) del producto en la sucursal activa, con las dos filas de auditoría de lo que cambió: todo o nada; si el precio local cambió desde que se cargó la pantalla, no escribe nada.
 * @idempotency Optimista — el precio local visto se compara dentro de la transacción; repetir el mismo pedido no escribe ni audita, y con un precio visto viejo da `PRECIO_DESACTUALIZADO`.
 * @transaction conTransaccionSerializable (SERIALIZABLE) con `tambienChoqueDeUnico`: dos primeras altas del mismo producto en la sucursal chocan con el único `(sucursalId, productoId)` y el reintento rechaza a la perdedora.
 * @sideEffects registrarCambioAuditado (PrecioLocalProducto.precio y .habilitado, del anterior al nuevo), en la misma transacción, por el paso compartido. La
 *   revalidación de la carta pública y el `sincronizable` los hace la Server Action.
 * @ficha permiso=precio_local transaccion=SERIALIZABLE idempotencia=OPTIMISTA auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function setPrecioLocalProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "transaccion" | "usuarioId" | "sucursalId">,
  comando: ComandoSetPrecioLocalProducto,
): Promise<ResultadoSetPrecioLocalProducto> {
  const { productoId, precio, habilitado, esperado } = comando;
  return conTransaccionSerializable(
    actor.transaccion,
    async (tx): Promise<ResultadoSetPrecioLocalProducto> => {
      const producto = await tx.producto.findUnique({ where: { id: productoId }, select: { id: true, nombre: true } });
      if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");

      const listo = exito(`Precio local de "${producto.nombre}" ${habilitado ? `fijado en ${precio}` : "cargado (deshabilitado, se usa el precio global)"}.`, null);
      const fila = await leerPrecioLocal(tx, { sucursalId: actor.sucursalId, productoId });
      if (fila && mismosCentavos(fila.precio, precio) && fila.habilitado === habilitado) return listo;

      const vioLoMismo = esperado === null ? fila === null : fila !== null && mismosCentavos(fila.precio, esperado.precio) && fila.habilitado === esperado.habilitado;
      if (!vioLoMismo) {
        const ahora = fila === null ? "ahora no tiene precio local" : `ahora es $${fila.precio.toLocaleString("es-AR")}${fila.habilitado ? "" : ", deshabilitado"}`;
        return fracaso("PRECIO_DESACTUALIZADO", `El precio local de "${producto.nombre}" cambió mientras lo editabas (${ahora}). Recargá la pantalla y volvé a hacer el cambio.`);
      }

      await guardarPrecioLocalEnTx(tx, actor, producto, precio, habilitado);
      return listo;
    },
    undefined,
    undefined,
    true,
  );
}
