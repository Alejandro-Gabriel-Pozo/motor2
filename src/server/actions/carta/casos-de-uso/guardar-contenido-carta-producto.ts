import "server-only";
import type { ContextoUsuario } from "@/core/auth/contexto";
import { LARGO_MAXIMO_DESCRIPCION_CARTA, normalizarTagsCarta, validarOrdenCarta, validarTextoLibreCarta } from "@/core/carta/validaciones";
import { MENSAJE_FALTA_SECCION_DE_CARTA, type ComandoGuardarContenidoCartaProducto, type ResultadoGuardarContenidoCartaProducto } from "@/core/features/carta/contenido-producto.schema";
import { exito, fracaso } from "@/core/resultado-caso";
import { guardarContenidoDeProducto } from "@/server/persistencia/carta/contenido-producto";
import { validarGeneroCartaOpcional } from "../generos-compartido";

/**
 * Caso de uso «guardar el contenido de carta de un producto de venta en la sucursal activa» (docs/plan-carta-catalogo-2026-09-24.md, M9; Hito 5, bloque D,
 * `docs/plan-hito-5-pureza.md` §6.1). Es el cuerpo que antes vivía en línea en la Server Action `guardarContenidoCartaProducto`
 * (`src/server/actions/carta/contenido-producto.ts`), movido TAL CUAL: las mismas lecturas con la base del contexto (sin transacción), el mismo orden de chequeos y los
 * mismos mensajes. La Server Action quedó como adaptador (`conPermiso("carta_contenido_producto")` → este caso de uso → `revalidarCartasPublicas` si salió
 * bien → `aResultadoAccion`). Sin guard de formato: el producto se lee ANTES de validar nada (un producto inexistente, o uno que no es PV, gana sobre una
 * descripción larga).
 *
 * `import "server-only"` y SIN `"use server"`: no es un endpoint. No chequea permisos. La carta es PROPIA de cada sucursal (ADR-009, C3): escribe siempre en
 * `actor.sucursalId`, nunca en otra. Sin fila = no se muestra (D3): guardar el contenido de un PV es lo que lo hace aparecer.
 *
 * Orden, igual que antes: 1. el producto (`No se encontró el producto.`; un MP: `Solo un producto de venta (PV) puede ir en la carta.`); 2. la descripción, los tags y
 * el orden; 3. visible sin sección (DA2); 4. la sección elegida, si hay (`No se encontró la sección de carta.`); 5. el género, si hay (que exista en la sucursal y esté
 * activo); 6. el `upsert` por (sucursal, producto).
 *
 * @contract Deja el contenido de carta del producto con los datos pedidos en la sucursal activa (una fila por par sucursal-producto), si cada dato es válido.
 * @idempotency Por estado — repetir el pedido vuelve a escribir los mismos valores sobre la misma fila (`upsert`).
 * @transaction Ninguna: lecturas y un `upsert` con `actor.db`, como antes.
 * @sideEffects Ninguno (el contenido no es plata: sin auditoría). La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_contenido_producto transaccion=NINGUNA idempotencia=POR_ESTADO auditoria=DOCUMENTO_PROPIO reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarContenidoCartaProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "sucursalId">,
  comando: ComandoGuardarContenidoCartaProducto,
): Promise<ResultadoGuardarContenidoCartaProducto> {
  const { productoId, datos } = comando;
  const producto = await actor.db.producto.findUnique({ where: { id: productoId }, select: { nombre: true, tipo: true } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (producto.tipo !== "PV") return fracaso("NO_ES_PV", "Solo un producto de venta (PV) puede ir en la carta.");

  const descripcion = validarTextoLibreCarta(datos.descripcion, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
  if (!descripcion.ok) return fracaso("DATO_INVALIDO", descripcion.mensaje);
  const tags = normalizarTagsCarta(datos.tags);
  if (!tags.ok) return fracaso("DATO_INVALIDO", tags.mensaje);
  const orden = validarOrdenCarta(datos.orden);
  if (!orden.ok) return fracaso("DATO_INVALIDO", orden.mensaje);

  const visibleEnCarta = datos.visibleEnCarta === true;
  const seccionCartaId = datos.seccionCartaId?.trim() || null;
  // DA2: visible exige sección; oculto se puede guardar sin ella (por si se vuelve a mostrar después).
  if (visibleEnCarta && !seccionCartaId) return fracaso("FALTA_SECCION", MENSAJE_FALTA_SECCION_DE_CARTA);
  if (seccionCartaId) {
    const seccion = await actor.db.seccionCarta.findUnique({ where: { id: seccionCartaId }, select: { id: true } });
    if (!seccion) return fracaso("SECCION_NO_ENCONTRADA", "No se encontró la sección de carta.");
  }
  const genero = await validarGeneroCartaOpcional(actor.db, actor.sucursalId, datos.generoCartaId);
  if (!genero.ok) return fracaso("GENERO_INVALIDO", genero.mensaje);

  const data = {
    visibleEnCarta,
    seccionCartaId,
    descripcion: descripcion.valor,
    tags: tags.valor,
    especial: datos.especial === true,
    orden: orden.valor,
    generoCartaId: genero.valor,
  };
  await guardarContenidoDeProducto(actor.db, { sucursalId: actor.sucursalId, productoId, datos: data });
  return exito(`Carta: "${producto.nombre}" ${data.visibleEnCarta ? "se muestra" : "queda oculto"}.`, null);
}
