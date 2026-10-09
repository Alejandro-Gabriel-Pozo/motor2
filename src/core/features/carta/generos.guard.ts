import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { validarNombreGeneroCarta, validarOrdenCarta } from "@/core/carta/public";
import type { ComandoGuardarGeneroCarta } from "./generos.schema";

/**
 * Guard de la feature «géneros de carta» (convención «guard por feature», 2026-09-25; Hito 5, bloque D, `docs/plan-hito-5-pureza.md` §6.1). Formato del comando, ANTES
 * de tocar la base; lo llama la Server Action DENTRO de su `conPermiso("carta_generos",…)`, así que el rechazo por permiso sigue llegando antes que el de
 * formato. Puro: sin Prisma ni permisos.
 *
 * Solo `guardarGeneroCarta` tiene guard: sus dos validaciones iban antes de la primera lectura. `actualizarActivoGeneroCarta` solo recibe un id y un booleano, que
 * nunca se validaron: sin guard (`SIN_GUARD` con motivo).
 */

/** Los datos de un género tal como llegan del formulario del admin (los mismos campos que `DatosGeneroCarta` de la Server Action). */
interface EntradaGeneroCarta {
  id?: string;
  nombre: unknown;
  orden?: unknown;
}

/**
 * Guard del comando «guardar un género»: EXACTAMENTE la validación que antes era lo primero de `guardarGeneroCarta`, antes de leer nada, con los MISMOS textos y en el
 * MISMO orden: el nombre y después el orden. El `id` pasa tal cual (lo resuelve el caso de uso).
 */
export function guardComandoGuardarGeneroCarta(datos: EntradaGeneroCarta): ResultadoDato<ComandoGuardarGeneroCarta> {
  const nombre = validarNombreGeneroCarta(datos.nombre);
  if (!nombre.ok) return rechazar("formato", nombre.mensaje);
  const orden = validarOrdenCarta(datos.orden);
  if (!orden.ok) return rechazar("formato", orden.mensaje);
  return aceptar({ ...(datos.id ? { id: datos.id } : {}), nombre: nombre.valor, orden: orden.valor });
}
