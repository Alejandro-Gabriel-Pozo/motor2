import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { mensajeDeChoqueDeNombre, whereCartaDeSucursal, type ChoqueDeNombre } from "@/core/carta/public";
import { validarNombreEnCarta } from "@/core/features/carta/contenido-producto.guard";
import type { ComandoConfirmarNombreEnCarta, ResultadoConfirmarNombreEnCarta } from "@/core/features/carta/contenido-producto.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
import { buscarChoqueDeNombreEnLaCarta } from "@/server/lecturas/carta/choque-de-nombre";
import { fijarNombreEnCartaSiVacio, tomarElProductoParaGuardarContenido, tomarLosNombresDeLaCarta } from "@/server/persistencia/carta/contenido-producto";

/**
 * Caso de uso «Está bien así» (confirmado por el dueño, 2026-11-04; `docs/diseno-nombre-en-carta-2026-11-04.md`, §11 F): un plato VISIBLE en la carta de la sucursal activa que todavía no tiene «Nombre en la
 * carta» (`NULL` = «sin decidir»: sale con el nombre del producto, pero figura «pendiente de completar») pasa a tener, A PROPÓSITO, el nombre del producto como nombre de carta. Queda independiente: si después
 * renombran el producto, el de la carta no cambia. Un solo plato por pedido; escribe SOLO en `actor.sucursalId`. No chequea permisos (los pone la Server Action: `carta_contenido_producto`).
 *
 * Orden: 1. el producto (existe, es de venta, no es una base: la carta de una base lee los rótulos de sus opciones); 2. que su nombre sirva como nombre de carta (el mismo validador del formulario: largo,
 * caracteres, sin saltos ni espacios a los costados); 3. DENTRO de la transacción, con el candado de los nombres de la sucursal y la fila del producto: que el plato esté visible acá; si ya tenía nombre de
 * carta, no es un error ni se escribe nada (`huboCambio: false`: dos clics a la vez, uno gana y el otro ve «ya estaba»); la regla de no repetir (otro plato, un ítem agrupado o una promo con ese nombre:
 * `NOMBRE_EN_USO`, y no copia); 4. el `UPDATE` condicionado a que siga vacío y su auditoría por columna (quién, cuándo, de `null` al nombre), en la misma transacción.
 *
 * @contract Deja el nombre del producto como «Nombre en la carta» del plato visible en la sucursal activa si estaba sin decidir y no choca con otro nombre de la carta; si ya lo tenía, no escribe nada.
 * @idempotency Por estado — repetirlo encuentra el nombre ya puesto: no escribe ni audita (`huboCambio: false`). Dos a la vez: el candado los ordena, uno escribe y el otro ve que ya estaba.
 * @transaction `actor.transaccion` (READ COMMITTED) con el candado de los nombres de la sucursal y la fila del producto (`FOR UPDATE`): la lectura, la regla de no repetir, el `UPDATE` y la auditoría, juntos.
 * @sideEffects registrarCambioAuditado (`ContenidoCartaProducto`, `nombreEnCarta`, con la sucursal) si cambió. La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_contenido_producto transaccion=SIMPLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function confirmarNombreEnCartaCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoConfirmarNombreEnCarta,
): Promise<ResultadoConfirmarNombreEnCarta> {
  const { productoId } = comando;
  const producto = await actor.db.producto.findUnique({ where: { id: productoId }, select: { nombre: true, tipo: true, modoDeVenta: true } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (producto.tipo !== "PV") return fracaso("NO_ES_PV", "Solo un producto de venta (PV) puede ir en la carta.");
  if (producto.modoDeVenta === "BASE_CONFIGURABLE") return fracaso("ES_BASE", `«${producto.nombre}» se vende por opción: la carta lee los rótulos de sus opciones, no su nombre.`);
  const valido = validarNombreEnCarta(producto.nombre);
  if (!valido.ok || valido.valor === null || valido.valor === undefined) {
    return fracaso("DATO_INVALIDO", `El nombre «${producto.nombre}» no sirve como nombre de carta${valido.ok ? "" : ` (${valido.mensaje})`}: escribí uno en la ficha del producto.`);
  }
  const nombre = valido.valor;

  const salida: { estado: "NO_ESTA" | "YA_ESTABA" | "CAMBIO" | "ADELANTADO"; choque: ChoqueDeNombre | null } = { estado: "CAMBIO", choque: null };
  await actor.transaccion(async (tx) => {
    await tomarLosNombresDeLaCarta(tx, actor.sucursalId);
    await tomarElProductoParaGuardarContenido(tx, productoId);
    const actual = await tx.contenidoCartaProducto.findFirst({ where: { ...whereCartaDeSucursal(actor.sucursalId), productoId }, select: { visibleEnCarta: true, nombreEnCarta: true } });
    if (!actual || !actual.visibleEnCarta) {
      salida.estado = "NO_ESTA";
      return;
    }
    if (actual.nombreEnCarta !== null) {
      salida.estado = "YA_ESTABA";
      return;
    }
    salida.choque = await buscarChoqueDeNombreEnLaCarta(tx, { sucursalId: actor.sucursalId, productoIdPropio: productoId, nombre });
    if (salida.choque) return;
    if ((await fijarNombreEnCartaSiVacio(tx, { sucursalId: actor.sucursalId, productoId, nombre })) === 0) {
      salida.estado = "ADELANTADO";
      return;
    }
    await registrarCambioAuditado(tx, {
      entidad: "ContenidoCartaProducto",
      entidadId: `${actor.sucursalId}:${productoId}`,
      campo: "nombreEnCarta",
      descripcion: `Carta de «${actor.sucursalNombre}»: «${producto.nombre}» confirmado a propósito con el nombre del producto como nombre en la carta («Está bien así»)`,
      valorAnterior: null,
      valorNuevo: nombre,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
  });
  const { estado, choque } = salida;
  if (estado === "NO_ESTA") return fracaso("NO_ESTA_EN_LA_CARTA", `«${producto.nombre}» no está visible en la carta de «${actor.sucursalNombre}»: no hay nada que confirmar.`);
  if (choque) return fracaso("NOMBRE_EN_USO", mensajeDeChoqueDeNombre(nombre, choque, actor.sucursalNombre));
  if (estado === "YA_ESTABA" || estado === "ADELANTADO") return exito(`«${producto.nombre}» ya tenía su nombre de carta.`, { huboCambio: false });
  return exito(`«${producto.nombre}» quedó con su nombre como nombre de carta.`, { huboCambio: true });
}
