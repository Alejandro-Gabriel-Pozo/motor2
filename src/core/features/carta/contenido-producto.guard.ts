import { LARGO_MAXIMO_DESCRIPCION_CARTA, normalizarTagsCarta, validarOrdenCarta, validarTextoLibreCarta } from "@/core/carta/public";
import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { RE_TEXTO_CATALOGO } from "@/core/texto";
import type { ContenidoCartaValidado } from "./contenido-producto.schema";

/**
 * Guard de la feature «contenido de carta de un producto» (S-52; convención «guard por feature», 2026-09-25). Formato y rango de lo que el cliente manda a
 * `guardarContenidoCartaProducto`, puro (sin Prisma ni permisos). Lo CALCULA la Server Action dentro de su `conPermiso("carta_contenido_producto", …)` con lo que mandó el
 * cliente, pero su RECHAZO lo aplica el caso de uso DESPUÉS de leer el producto: un producto inexistente, o uno que no es PV, gana sobre una descripción larga o un orden roto
 * (fijado por tests). Mismos textos y mismo orden de siempre: la descripción, los tags y el orden. Suma lo que antes reventaba con un error crudo: los datos tienen que ser un
 * objeto y la sección y el género, texto (o vacíos).
 */
/** El tope de «Nombre en la carta» (CHECK `ContenidoCartaProducto_nombre_en_carta_chk`): el de un nombre de catálogo. */
export const LARGO_MAXIMO_DEL_NOMBRE_EN_CARTA = 80;

/**
 * «Nombre en la carta» (pedido del dueño, 2026-11-04). Ausente (`undefined`) queda ausente (un formulario que no lo muestra no lo toca); `null`, vacío o solo espacios es «sin nombre en la carta» (`null`: la carta
 * usa el nombre interno); si no, UNA línea (sin saltos), sin espacios a los costados (no se recorta: se avisa), de hasta 80 caracteres y con el juego de caracteres de un nombre de catálogo (letras, números,
 * espacios y `- . , ( ) % & / ' _`: nunca HTML). El CHECK de la base repite el tope, los costados y los saltos.
 */
function nombreEnCarta(valor: unknown): ResultadoDato<string | null | undefined> {
  if (valor === undefined) return aceptar(undefined);
  if (valor === null) return aceptar(null);
  const etiqueta = "«Nombre en la carta»";
  if (typeof valor !== "string") return rechazar("formato", `${etiqueta} no es un texto válido.`);
  if (valor.trim() === "") return aceptar(null);
  if (/[\r\n]/.test(valor)) return rechazar("formato", `${etiqueta} va en una sola línea: sacá los saltos de línea.`);
  if (valor !== valor.trim()) return rechazar("formato", `${etiqueta} no puede empezar ni terminar con espacios: borralos y volvé a guardar.`);
  if (Array.from(valor).length > LARGO_MAXIMO_DEL_NOMBRE_EN_CARTA) return rechazar("largo", `${etiqueta} tiene hasta ${LARGO_MAXIMO_DEL_NOMBRE_EN_CARTA} caracteres: acortalo.`);
  if (!RE_TEXTO_CATALOGO.test(valor)) return rechazar("formato", `${etiqueta} tiene caracteres no permitidos. Se admiten letras, números, espacios y - . , ( ) % & / '`);
  if (valor.startsWith("-")) return rechazar("formato", `${etiqueta} no puede empezar con "-".`);
  return aceptar(valor);
}

export function guardComandoGuardarContenidoCartaProducto(entrada: { datos: unknown }): ResultadoDato<ContenidoCartaValidado> {
  const { datos } = entrada;
  if (typeof datos !== "object" || datos === null || Array.isArray(datos)) return rechazar("formato", "Los datos del contenido de la carta no son válidos.");
  const d = datos as { descripcion?: unknown; tags?: unknown; orden?: unknown; seccionCartaId?: unknown; generoCartaId?: unknown; mostrarNombreArriba?: unknown; nombreEnCarta?: unknown };

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
  // Fase 5 (DEC-11): «Mostrar el nombre arriba», si viene, es un sí o un no (un texto «false» sería verdadero en JS).
  if (d.mostrarNombreArriba !== undefined && typeof d.mostrarNombreArriba !== "boolean") return rechazar("formato", "«Mostrar el nombre del producto arriba» no es válido.");
  const nombre = nombreEnCarta(d.nombreEnCarta);
  if (!nombre.ok) return nombre;
  return aceptar({ descripcion: descripcion.valor, tags: tags.valor, orden: orden.valor, ...(nombre.valor === undefined ? {} : { nombreEnCarta: nombre.valor }) });
}
