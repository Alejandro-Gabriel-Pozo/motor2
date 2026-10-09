import { aceptar, rechazar, type ResultadoDato } from "@/core/datos/resultado";
import type { ComandoCrearCategoriaProducto } from "./categorias-producto.schema";
import { nombreDeCatalogo } from "./nombre-de-catalogo";

/**
 * Guard de la feature «categorías de producto» (convención «guard por feature», 2026-09-25; Hito 4, bloque 4.3, paso H4C-7). Formato del comando, ANTES de tocar la
 * base; lo llama la Server Action DENTRO de su `conPermisoDeEmpresa(…)`, así que el rechazo por permiso sigue llegando antes que el de formato. Puro: sin Prisma ni
 * permisos.
 *
 * Es EXACTAMENTE lo que antes era lo primero de `crearCategoriaProducto` (src/server/actions/catalogo/categorias-producto.ts), antes de buscar la categoría por
 * nombre: el nombre recortado no vacío y con el charset y el largo de catálogo, con los MISMOS textos y en el MISMO orden. `actualizarActivaCategoriaProducto` no
 * tiene guard (solo recibe un id y un booleano).
 */

/** O.44: el «no encontrado» de activar o desactivar una categoría con un id que no existe (o de otra empresa). Mismo texto que el de `guardarMargenObjetivo`. */
export const MENSAJE_CATEGORIA_NO_ENCONTRADA = "No se encontró la categoría.";

export function guardComandoCrearCategoriaProducto(entrada: { nombre: unknown }): ResultadoDato<ComandoCrearCategoriaProducto> {
  const nombre = nombreDeCatalogo(entrada.nombre, "El nombre de la categoría no puede estar vacío.", "El nombre de la categoría");
  if (!nombre.ok) return rechazar(nombre.codigo, nombre.mensaje);
  return aceptar({ nombre: nombre.valor });
}
