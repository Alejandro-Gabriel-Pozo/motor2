import { LARGO_MAXIMO_DESCRIPCION_CARTA, normalizarTagsCarta, validarOrdenCarta, validarTextoLibreCarta } from "@/core/carta/public";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ContenidoCartaValidado } from "./contenido-producto.schema";

/**
 * Guard de la feature «contenido de carta de un producto» (S-52; convención «guard por feature», 2026-09-25). Formato y rango de lo que el cliente manda a
 * `guardarContenidoCartaProducto`, puro (sin Prisma ni permisos). Lo CALCULA la Server Action dentro de su `conPermiso("carta_contenido_producto", …)` con lo que mandó el
 * cliente, pero su RECHAZO lo aplica el caso de uso DESPUÉS de leer el producto: un producto inexistente, o uno que no es PV, gana sobre una descripción larga o un orden roto
 * (fijado por tests). Mismos textos y mismo orden de siempre: la descripción, los tags y el orden. Suma lo que antes reventaba con un error crudo: los datos tienen que ser un
 * objeto y la sección y el género, texto (o vacíos).
 */
export function guardComandoGuardarContenidoCartaProducto(entrada: { datos: unknown }): ResultadoDato<ContenidoCartaValidado> {
  const { datos } = entrada;
  if (typeof datos !== "object" || datos === null || Array.isArray(datos)) return rechazar("formato", "Los datos del contenido de la carta no son válidos.");
  const d = datos as { descripcion?: unknown; tags?: unknown; orden?: unknown; seccionCartaId?: unknown; generoCartaId?: unknown };

  const descripcion = validarTextoLibreCarta(d.descripcion, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
  if (!descripcion.ok) return rechazar("largo", descripcion.mensaje);
  const tags = normalizarTagsCarta(d.tags as readonly string[] | string | null | undefined);
  if (!tags.ok) return rechazar("formato", tags.mensaje);
  // Un orden es un número o un texto con un número (o vacío): un objeto o un arreglo no lo es (`String([])` es vacío y valía 0).
  const orden = validarOrdenCarta(typeof d.orden === "object" && d.orden !== null ? Number.NaN : d.orden);
  if (!orden.ok) return rechazar("formato", orden.mensaje);
  for (const [valor, mensaje] of [[d.seccionCartaId, "La sección de carta no es válida."], [d.generoCartaId, "El género no es válido."]] as const) {
    if (valor !== undefined && valor !== null && typeof valor !== "string") return rechazar("formato", mensaje);
  }
  return aceptar({ descripcion: descripcion.valor, tags: tags.valor, orden: orden.valor });
}
