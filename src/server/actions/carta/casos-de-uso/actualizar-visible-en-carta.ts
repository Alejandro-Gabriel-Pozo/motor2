import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { whereCartaDeSucursal } from "@/core/carta/public";
import { MENSAJE_FALTA_SECCION_DE_CARTA, type ComandoActualizarVisibleEnCarta, type ResultadoActualizarVisibleEnCarta } from "@/core/features/carta/contenido-producto.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { fijarVisibleEnCarta } from "@/server/persistencia/carta/contenido-producto";

/**
 * Caso de uso «mostrar u ocultar un producto en la carta de la sucursal activa» (el atajo; docs/plan-carta-catalogo-2026-09-24.md, M9; Hito 5, bloque D,
 * `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo que antes vivía en línea en la Server Action `actualizarVisibleEnCarta`
 * (`src/server/actions/carta/contenido-producto.ts`), movido TAL CUAL: crea la fila si no existía (con el resto vacío); mostrar exige que el contenido de ESTA
 * sucursal ya tenga sección de carta (DA2: la fila de otra sucursal no cuenta, `whereCartaDeSucursal`). La Server Action quedó como adaptador
 * (`conPermisoDeEmpresa("carta_contenido_producto")` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Sin guard: solo recibe un id y un booleano, que nunca se validaron.
 *
 * @contract Deja el producto mostrado u oculto en la carta de la sucursal activa; mostrar exige que su contenido ya tenga sección.
 * @idempotency Por estado — repetir el pedido vuelve a escribir el mismo valor sobre la misma fila (`upsert`).
 * @transaction Ninguna: una lectura y un `upsert` con `actor.db`, como antes.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_contenido_producto transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarVisibleEnCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoActualizarVisibleEnCarta,
): Promise<ResultadoActualizarVisibleEnCarta> {
  const { productoId, visibleEnCarta } = comando;
  const producto = await actor.db.producto.findUnique({
    where: { id: productoId },
    select: { nombre: true, tipo: true, contenidosCarta: { where: whereCartaDeSucursal(actor.sucursalId), take: 1, select: { seccionCartaId: true } } },
  });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (producto.tipo !== "PV") return fracaso("NO_ES_PV", "Solo un producto de venta (PV) puede ir en la carta.");
  if (visibleEnCarta && !producto.contenidosCarta[0]?.seccionCartaId) return fracaso("FALTA_SECCION", MENSAJE_FALTA_SECCION_DE_CARTA);
  await fijarVisibleEnCarta(actor.db, { sucursalId: actor.sucursalId, productoId, visibleEnCarta });
  return exito(`Carta: "${producto.nombre}" ${visibleEnCarta ? "se muestra" : "queda oculto"}.`, null);
}
