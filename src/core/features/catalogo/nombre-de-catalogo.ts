import { rechazar, aceptar, type ResultadoDato } from "@/core/datos/resultado";
import { texto, validarTextoCatalogo } from "@/core/texto";

/**
 * El nombre de un dato del catálogo (categoría, unidad, insumo, grupo, producto) tal como lo validaban en línea las Server Actions de
 * `src/server/actions/catalogo/` ANTES de su primera lectura (Hito 4 de la pureza, bloque 4.3): `texto()` (recorta; `null`/`undefined` → vacío), vacío →
 * `mensajeVacio`, y `validarTextoCatalogo` con la etiqueta del campo (largo, caracteres, el `-` del principio), con sus MISMOS textos y en ese orden. Devuelve el
 * nombre ya recortado: es el que se guarda. Puro: lo comparten los guards de `core/features/catalogo/` (no es un guard por sí mismo).
 */
export function nombreDeCatalogo(nombre: unknown, mensajeVacio: string, etiqueta: string): ResultadoDato<string> {
  const n = texto(nombre);
  if (!n) return rechazar("vacio", mensajeVacio);
  const invalido = validarTextoCatalogo(n, etiqueta);
  if (invalido) return rechazar("caracteres", invalido);
  return aceptar(n);
}
