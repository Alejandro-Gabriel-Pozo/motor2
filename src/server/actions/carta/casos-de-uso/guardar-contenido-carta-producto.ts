import "server-only";
import type { ContextoUsuario } from "@/server/sesion/contexto";
import { whereCartaDeSucursal } from "@/core/carta/public";
import { registrarCambioAuditado } from "@/server/auditoria/registrar-cambio-auditado";
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
 * el orden (y, desde la Fase 5, que «Mostrar el nombre arriba» sea un sí o un no); 3. visible sin sección (DA2); 4. la sección elegida, si hay (`No se encontró la sección de carta.`); 5. el género,
 * si hay (que exista en la sucursal y esté activo); 6. el `upsert` por (sucursal, producto).
 *
 * Fase 5 de la ola «precio y carta» (DEC-11): «Mostrar el nombre arriba» (`mostrarNombreArriba`), el interruptor de un producto base con un solo eje, decide cómo se LEE el producto en la carta
 * pública, así que se audita POR COLUMNA (`ContenidoCartaProducto.mostrarNombreArriba`, del valor que había —el default `false` si no había fila— al nuevo, con la sucursal), en la MISMA transacción
 * que la escritura. Si el pedido no trae la clave, no se toca ni se audita. Repetir el mismo valor no deja otra fila (`registrarCambioAuditado` no anota lo que no cambió). El resto del contenido
 * (descripción, tags, ★, orden, sección, género) sigue sin auditoría, como antes.
 *
 * @contract Deja el contenido de carta del producto con los datos pedidos en la sucursal activa (una fila por par sucursal-producto), si cada dato es válido; con su auditoría si cambió «Mostrar el nombre arriba».
 * @idempotency Por estado — repetir el pedido vuelve a escribir los mismos valores sobre la misma fila (`upsert`) y no deja otra fila de auditoría.
 * @transaction `actor.transaccion` (READ COMMITTED): el valor anterior del interruptor, el `upsert` y su auditoría, juntos; las lecturas que validan van antes con `actor.db`, como antes.
 * @sideEffects registrarCambioAuditado (`ContenidoCartaProducto`, `mostrarNombreArriba`, con la sucursal) si cambió, en la misma transacción. La revalidación de la carta pública la hace la Server Action cuando sale bien.
 * @ficha permiso=carta_contenido_producto transaccion=SIMPLE idempotencia=POR_ESTADO auditoria=REGISTRO_AUDITORIA reloj=INYECTADO periodo=NO_APLICA
 */
export async function guardarContenidoCartaProductoCasoDeUso(
  actor: Pick<ContextoUsuario, "db" | "transaccion" | "usuarioId" | "sucursalId" | "sucursalNombre">,
  comando: ComandoGuardarContenidoCartaProducto,
): Promise<ResultadoGuardarContenidoCartaProducto> {
  const { productoId, datos, validados } = comando;
  const producto = await actor.db.producto.findUnique({ where: { id: productoId }, select: { nombre: true, tipo: true } });
  if (!producto) return fracaso("PRODUCTO_NO_ENCONTRADO", "No se encontró el producto.");
  if (producto.tipo !== "PV") return fracaso("NO_ES_PV", "Solo un producto de venta (PV) puede ir en la carta.");

  // S-52: la descripción, los tags y el orden (en ese orden) los decidió `guardComandoGuardarContenidoCartaProducto`; su rechazo se aplica ACÁ, después de leer el producto.
  if (!validados.ok) return fracaso("DATO_INVALIDO", validados.mensaje);
  const { descripcion, tags, orden } = validados.valor;

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

  const { mostrarNombreArriba } = datos;
  const data = {
    visibleEnCarta,
    seccionCartaId,
    descripcion,
    tags,
    especial: datos.especial === true,
    orden,
    generoCartaId: genero.valor,
    ...(mostrarNombreArriba !== undefined ? { mostrarNombreArriba } : {}),
  };
  await actor.transaccion(async (tx) => {
    // El valor que había, leído en la transacción (por la relación del producto, en la carta de ESTA sucursal): sin fila, el default de la columna.
    const actual = mostrarNombreArriba === undefined ? null : await tx.producto.findUnique({ where: { id: productoId }, select: { contenidosCarta: { where: whereCartaDeSucursal(actor.sucursalId), take: 1, select: { mostrarNombreArriba: true } } } });
    await guardarContenidoDeProducto(tx, { sucursalId: actor.sucursalId, productoId, datos: data });
    if (mostrarNombreArriba === undefined) return;
    await registrarCambioAuditado(tx, {
      entidad: "ContenidoCartaProducto",
      entidadId: `${actor.sucursalId}:${productoId}`,
      campo: "mostrarNombreArriba",
      descripcion: `Carta de «${actor.sucursalNombre}»: «${producto.nombre}» ${mostrarNombreArriba ? "con el nombre arriba" : "sin el nombre arriba (cada opción con su nombre)"}`,
      valorAnterior: actual?.contenidosCarta[0]?.mostrarNombreArriba ?? false,
      valorNuevo: mostrarNombreArriba,
      actorId: actor.usuarioId,
      sucursalId: actor.sucursalId,
    });
  });
  return exito(`Carta: "${producto.nombre}" ${data.visibleEnCarta ? "se muestra" : "queda oculto"}.`, null);
}
