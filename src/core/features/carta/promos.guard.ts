import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { LARGO_MAXIMO_DESCRIPCION_CARTA, LARGO_MAXIMO_TITULO_CARTA, validarOrdenCarta, validarPrecioCarta, validarTextoLibreCarta } from "@/core/carta/public";
import type { ComandoGuardarPromoCarta } from "./promos.schema";

/**
 * Guard de la feature «promos de la carta» (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.2, paso H4C-2). Formato del comando, ANTES de tocar la
 * base; lo llama la Server Action DENTRO de su envoltorio, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin Prisma ni permisos.
 *
 * Solo `guardarPromoCarta` tiene guard: es la única acción de promos cuyas validaciones iban TODAS antes de la primera lectura. Las demás leen la promo
 * primero (un id inexistente gana sobre un dato inválido) y validan en su caso de uso (`SIN_GUARD` con motivo).
 */

/** Los datos de una promo tal como llegan del formulario del admin (los mismos campos que `DatosPromoCarta` de la Server Action). */
interface EntradaPromoCarta {
  id?: string;
  seccionCartaId: string;
  titulo: unknown;
  descripcion?: unknown;
  precio: unknown;
  orden?: unknown;
}

/**
 * Guard del comando «guardar una promo». Es EXACTAMENTE la validación que antes era lo primero de `guardarPromoCarta`, antes de leer la sección, con los MISMOS
 * textos y en el MISMO orden: el título (largo, y que no quede vacío: «La promo necesita un título.»), la descripción, el precio y el orden. Los ids pasan tal
 * cual (los resuelve el caso de uso).
 */
export function guardComandoGuardarPromoCarta(datos: EntradaPromoCarta): ResultadoDato<ComandoGuardarPromoCarta> {
  const titulo = validarTextoLibreCarta(datos.titulo, "El título", LARGO_MAXIMO_TITULO_CARTA);
  if (!titulo.ok) return rechazar("largo", titulo.mensaje);
  if (!titulo.valor) return rechazar("vacio", "La promo necesita un título.");
  const descripcion = validarTextoLibreCarta(datos.descripcion, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
  if (!descripcion.ok) return rechazar("largo", descripcion.mensaje);
  const precio = validarPrecioCarta(datos.precio);
  if (!precio.ok) return rechazar("formato", precio.mensaje);
  const orden = validarOrdenCarta(datos.orden);
  if (!orden.ok) return rechazar("formato", orden.mensaje);
  return aceptar({
    ...(datos.id ? { id: datos.id } : {}),
    seccionCartaId: datos.seccionCartaId,
    titulo: titulo.valor,
    descripcion: descripcion.valor,
    precio: precio.valor,
    orden: orden.valor,
  });
}
