import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import { nombreDeCatalogo } from "./nombre-de-catalogo";
import type { ComandoActualizarDecimalesUnidad, ComandoCrearUnidad, MagnitudUnidad } from "./unidades.schema";

/**
 * Guard de la feature «unidades de medida» (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.3, paso H4C-8). Formato del comando, ANTES de tocar la
 * base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa(…)`, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin Prisma
 * ni permisos. Son EXACTAMENTE las validaciones que antes eran lo primero de `crearUnidad` y de `actualizarDecimalesUnidad`
 * (src/server/actions/catalogo/unidades.ts), con los MISMOS textos y en el MISMO orden. `actualizarActivaUnidad` no tiene guard (solo recibe un id y un booleano).
 */

/** Los decimales de una unidad nueva cuando el formulario no los manda (vivía en `src/server/actions/catalogo/unidades.ts`). */
const DECIMALES_DEFAULT_POR_MAGNITUD: Record<MagnitudUnidad, number> = {
  CANTIDAD: 0,
  PESO: 2,
  VOLUMEN: 2,
};

const MENSAJE_DECIMALES = "Los decimales tienen que ser un entero entre 0 y 6.";

/** O.44: el «no encontrado» de activar o desactivar una unidad con un id que no existe (o de otra empresa). Mismo texto que el de `actualizarDecimalesUnidad`. */
export const MENSAJE_UNIDAD_NO_ENCONTRADA = "No se encontró la unidad.";

const decimalesValidos = (decimales: number): boolean => Number.isInteger(decimales) && decimales >= 0 && decimales <= 6;

/**
 * Guard del comando «crear una unidad»: el nombre (recortado, no vacío, charset y largo de catálogo) y los decimales (los pedidos o los de la magnitud; una magnitud
 * desconocida no tiene default y cae en el mismo rechazo de los decimales, como antes). Que el nombre esté libre lo resuelve el caso de uso.
 */
export function guardComandoCrearUnidad(datos: { nombre: unknown; magnitud: MagnitudUnidad; decimales?: number }): ResultadoDato<ComandoCrearUnidad> {
  const nombre = nombreDeCatalogo(datos.nombre, "El nombre de la unidad no puede estar vacío.", "El nombre de la unidad");
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);

  const decimales = datos.decimales ?? DECIMALES_DEFAULT_POR_MAGNITUD[datos.magnitud];
  if (!decimalesValidos(decimales)) return rechazar("rango", MENSAJE_DECIMALES);
  return aceptar({ nombre: nombre.valor, magnitud: datos.magnitud, decimales });
}

/** Guard del comando «cambiar los decimales de una unidad»: un entero entre 0 y 6. El id pasa tal cual (lo resuelve el caso de uso, «No se encontró la unidad.»). */
export function guardComandoActualizarDecimalesUnidad(entrada: { unidadId: string; decimales: number }): ResultadoDato<ComandoActualizarDecimalesUnidad> {
  if (!decimalesValidos(entrada.decimales)) return rechazar("rango", MENSAJE_DECIMALES);
  return aceptar({ unidadId: entrada.unidadId, decimales: entrada.decimales });
}
