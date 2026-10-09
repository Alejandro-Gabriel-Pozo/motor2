import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import {
  LARGO_MAXIMO_DESCRIPCION_CARTA,
  LARGO_MAXIMO_TITULO_CARTA,
  validarImagenUrlCarta,
  validarNombreSeccionCarta,
  validarOrdenCarta,
  validarTextoLibreCarta,
} from "@/core/carta/public";
import type { ComandoGuardarSeccionCarta } from "./secciones.schema";

/**
 * Guard de la feature «secciones de carta» (convención «guard por feature», 2026-09-25; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Formato del comando,
 * ANTES de tocar la base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa("carta_secciones", …)`, así que el rechazo por permiso sigue llegando antes
 * que el de formato. Puro: sin Prisma ni permisos.
 *
 * Solo `guardarSeccionCarta` tiene guard: sus validaciones iban TODAS antes de la primera lectura. `actualizarActivaSeccionCarta` solo recibe un id y un booleano, que
 * nunca se validaron: sin guard (`SIN_GUARD` con motivo).
 */

/** Los datos de una sección tal como llegan del formulario del admin (los mismos campos que `DatosSeccionCarta` de la Server Action). */
interface EntradaSeccionCarta {
  id?: string;
  nombre: unknown;
  titulo?: unknown;
  descripcion?: unknown;
  imagenUrl?: unknown;
  orden?: unknown;
}

/**
 * Guard del comando «guardar una sección de carta»: EXACTAMENTE la validación que antes era lo primero de `guardarSeccionCarta`, antes de leer nada, con los MISMOS
 * textos y en el MISMO orden: el nombre, el título, la descripción, la imagen y el orden. El `id` pasa tal cual (lo resuelve el caso de uso).
 */
export function guardComandoGuardarSeccionCarta(datos: EntradaSeccionCarta): ResultadoDato<ComandoGuardarSeccionCarta> {
  const nombre = validarNombreSeccionCarta(datos.nombre);
  if (!nombre.ok) return rechazar("formato", nombre.mensaje);
  const titulo = validarTextoLibreCarta(datos.titulo, "El título", LARGO_MAXIMO_TITULO_CARTA);
  if (!titulo.ok) return rechazar("largo", titulo.mensaje);
  const descripcion = validarTextoLibreCarta(datos.descripcion, "La descripción", LARGO_MAXIMO_DESCRIPCION_CARTA);
  if (!descripcion.ok) return rechazar("largo", descripcion.mensaje);
  const imagenUrl = validarImagenUrlCarta(datos.imagenUrl);
  if (!imagenUrl.ok) return rechazar("formato", imagenUrl.mensaje);
  const orden = validarOrdenCarta(datos.orden);
  if (!orden.ok) return rechazar("formato", orden.mensaje);
  return aceptar({
    ...(datos.id ? { id: datos.id } : {}),
    nombre: nombre.valor,
    titulo: titulo.valor,
    descripcion: descripcion.valor,
    imagenUrl: imagenUrl.valor,
    orden: orden.valor,
  });
}
