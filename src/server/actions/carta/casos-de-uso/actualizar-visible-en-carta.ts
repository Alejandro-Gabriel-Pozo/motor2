import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { mensajeDeChoqueDeNombre, whereCartaDeSucursal, type ChoqueDeNombre } from "@/core/carta/public";
import { MENSAJE_FALTA_SECCION_DE_CARTA, type ComandoActualizarVisibleEnCarta, type ResultadoActualizarVisibleEnCarta } from "@/core/features/carta/contenido-producto.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { buscarChoqueDeNombreEnLaCarta } from "@/server/lecturas/carta/choque-de-nombre";
import { fijarVisibleEnCarta, tomarLosNombresDeLaCarta } from "@/server/persistencia/carta/contenido-producto";

/**
 * Caso de uso «mostrar u ocultar un producto en la carta de la sucursal activa» (el atajo; docs/plan-carta-catalogo-2026-09-24.md, M9; Hito 5, bloque D,
 * `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo que antes vivía en línea en la Server Action `actualizarVisibleEnCarta`
 * (`src/server/actions/carta/contenido-producto.ts`), movido TAL CUAL: crea la fila si no existía (con el resto vacío); mostrar exige que el contenido de ESTA
 * sucursal ya tenga sección de carta (DA2: la fila de otra sucursal no cuenta, `whereCartaDeSucursal`). La Server Action quedó como adaptador
 * (`conPermiso("carta_contenido_producto")` → este caso de uso → `revalidarCartasPublicas` si salió bien → `aResultadoAccion`).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. Sin guard: solo recibe un id y un booleano, que nunca se validaron.
 *
 * Regla del dueño (2026-11-04): en la carta de una sucursal no hay dos cosas con el mismo nombre. MOSTRAR un plato lo comprueba (con su nombre en la carta, o el del producto si no lo tiene) dentro de una
 * transacción con el candado de los nombres de la sucursal: si otro plato, un ítem agrupado o una promo ya lo usa, `NOMBRE_EN_USO` y no escribe. Ocultar no choca con nada y no necesita la transacción.
 *
 * @contract Deja el producto mostrado u oculto en la carta de la sucursal activa; mostrar exige que su contenido ya tenga sección.
 * @idempotency Por estado — repetir el pedido vuelve a escribir el mismo valor sobre la misma fila (`upsert`).
 * @transaction Ocultar: una lectura y un `upsert` con `actor.db`, como antes. Mostrar: `actor.transaccion` (READ COMMITTED) con el candado de los nombres de la sucursal: la búsqueda del nombre repetido y el `upsert`, juntos.
 * @sideEffects Ninguno (sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_contenido_producto transaccion=SIMPLE idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarVisibleEnCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "sucursalId">,
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
  if (!visibleEnCarta) {
    await fijarVisibleEnCarta(actor.db, { sucursalId: actor.sucursalId, productoId, visibleEnCarta });
    return exito(`Carta: "${producto.nombre}" queda oculto.`, null);
  }
  let choque: ChoqueDeNombre | null = null;
  let nombreEfectivo = producto.nombre;
  await actor.transaccion(async (tx) => {
    await tomarLosNombresDeLaCarta(tx, actor.sucursalId);
    const propio = await tx.contenidoCartaProducto.findFirst({ where: { ...whereCartaDeSucursal(actor.sucursalId), productoId }, select: { nombreEnCarta: true } });
    nombreEfectivo = propio?.nombreEnCarta ?? producto.nombre;
    choque = await buscarChoqueDeNombreEnLaCarta(tx, { sucursalId: actor.sucursalId, productoIdPropio: productoId, nombre: nombreEfectivo });
    if (choque) return;
    await fijarVisibleEnCarta(tx, { sucursalId: actor.sucursalId, productoId, visibleEnCarta });
  });
  if (choque) return fracaso("NOMBRE_EN_USO", mensajeDeChoqueDeNombre(nombreEfectivo, choque));
  return exito(`Carta: "${producto.nombre}" se muestra.`, null);
}
