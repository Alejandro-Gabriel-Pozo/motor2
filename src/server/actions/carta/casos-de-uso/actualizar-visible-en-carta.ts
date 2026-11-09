import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { mensajeDeChoqueDeNombre, whereCartaDeSucursal, type ChoqueDeNombre } from "@/core/carta/public";
import { MENSAJE_FALTA_SECCION_DE_CARTA, type ComandoActualizarVisibleEnCarta, type ResultadoActualizarVisibleEnCarta } from "@/core/features/carta/contenido-producto.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { buscarChoqueDeNombreEnLaCarta } from "@/server/lecturas/carta/choque-de-nombre";
import { fijarVisibleEnCarta, tomarElProductoParaGuardarContenido, tomarLosNombresDeLaCarta } from "@/server/persistencia/carta/contenido-producto";
import { esBaseConfigurable } from "@/core/opciones/public";

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
 * transacción con el candado de los nombres de la sucursal: si otro plato, un ítem agrupado o una promo ya lo usa, `NOMBRE_EN_USO` y no escribe. Ocultar no choca con nada.
 *
 * Auditoría (poda del 2026-11-06, decisión del dueño): desde que «Ocultar» es el ÚNICO camino para sacar un producto de la carta (se retiró el botón «Quitar de la carta»), cada cambio de visibilidad deja
 * su fila (`ContenidoCartaProducto.visibleEnCarta`, quién, cuándo, de qué a qué; `null` = el producto no tenía contenido en la sucursal), DENTRO de la transacción del cambio y con la fila del producto tomada
 * (`FOR UPDATE`, la misma que toman los guardados del contenido): dos pedidos a la vez se ordenan y el segundo ve lo que dejó el primero, así que no se duplica el rastro. Repetir el mismo valor no audita.
 *
 * @contract Deja el producto mostrado u oculto en la carta de la sucursal activa; mostrar exige que su contenido ya tenga sección.
 * @idempotency Por estado — repetir el pedido vuelve a escribir el mismo valor sobre la misma fila (`upsert`).
 * @transaction `actor.transaccion` (READ COMMITTED) con la fila del producto (`FOR UPDATE`): la lectura del valor anterior, el `upsert` y la auditoría, juntos. Mostrar suma el candado de los nombres de la sucursal y la búsqueda del nombre repetido.
 * @sideEffects registrarCambioAuditado (`ContenidoCartaProducto`, `visibleEnCarta`, con la sucursal) si cambió. La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_contenido_producto transaccion=SIMPLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function actualizarVisibleEnCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoActualizarVisibleEnCarta,
): Promise<ResultadoActualizarVisibleEnCarta> {
  const { productoId, visibleEnCarta } = comando;
  const producto = await actor.db.producto.findUnique({
    where: { id: productoId },
    select: { nombre: true, tipo: true, modoDeVenta: true, contenidosCarta: { where: whereCartaDeSucursal(actor.sucursalId), take: 1, select: { seccionCartaId: true } } },
  });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (producto.tipo !== "PV") return fracaso("NO_ES_PV", "Solo un producto de venta (PV) puede ir en la carta.");
  if (visibleEnCarta && !producto.contenidosCarta[0]?.seccionCartaId) return fracaso("FALTA_SECCION", MENSAJE_FALTA_SECCION_DE_CARTA);
  let choque: ChoqueDeNombre | null = null;
  let nombreEfectivo = producto.nombre;
  await actor.transaccion(async (tx) => {
    await tomarElProductoParaGuardarContenido(tx, productoId);
    if (visibleEnCarta) await tomarLosNombresDeLaCarta(tx, actor.sucursalId);
    const propio = await tx.contenidoCartaProducto.findFirst({ where: { ...whereCartaDeSucursal(actor.sucursalId), productoId }, select: { visibleEnCarta: true, nombreEnCarta: true } });
    if (visibleEnCarta) {
      nombreEfectivo = propio?.nombreEnCarta ?? producto.nombre;
      // Una base se lee en la carta por los rótulos de sus opciones, no por su nombre: sin nombre en la carta no ocupa ninguno; con uno, solo se compara con los nombres en la carta de los demás.
      const esBase = esBaseConfigurable(producto.modoDeVenta);
      if (!esBase || propio?.nombreEnCarta != null) {
        choque = await buscarChoqueDeNombreEnLaCarta(tx, { sucursalId: actor.sucursalId, productoIdPropio: productoId, nombre: nombreEfectivo, soloNombresEnCarta: esBase });
        if (choque) return;
      }
    }
    await fijarVisibleEnCarta(tx, { sucursalId: actor.sucursalId, productoId, visibleEnCarta });
    await registrarCambioAuditado(tx, {
      entidad: "ContenidoCartaProducto",
      entidadId: `${actor.sucursalId}:${productoId}`,
      campo: "visibleEnCarta",
      descripcion: `Carta de «${actor.sucursalNombre}»: «${producto.nombre}» ${visibleEnCarta ? "se muestra" : "queda oculto"}`,
      valorAnterior: propio?.visibleEnCarta ?? null,
      valorNuevo: visibleEnCarta,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
  });
  if (choque) return fracaso("NOMBRE_EN_USO", mensajeDeChoqueDeNombre(nombreEfectivo, choque, actor.sucursalNombre));
  return exito(`Carta: "${producto.nombre}" ${visibleEnCarta ? "se muestra" : "queda oculto"}.`, null);
}
