import { LARGO_MAXIMO_TEXTO_CATALOGO, texto, validarTextoCatalogo } from "@/core/texto";
import { aceptar, rechazar, type ResultadoDato } from "./resultado";

const RE_ALFANUMERICO = /[\p{L}\p{N}]/u;

/**
 * Nombre de catálogo (producto, proveedor, categoría, unidad, sección…): las reglas de `validarTextoCatalogo` (charset, 80 caracteres,
 * sin "-" inicial) más "no vacío si es obligatorio" y "al menos una letra o un número" ("()" o "..." no nombran nada). Recortado;
 * vacío no obligatorio → `null`.
 */
export function validarNombreCatalogo(valor: unknown, etiqueta: string, opciones: { obligatorio: boolean }): ResultadoDato<string | null> {
  const v = texto(valor);
  if (!v) return opciones.obligatorio ? rechazar("vacio", `${etiqueta} no puede estar vacío.`) : aceptar(null);
  const invalido = validarTextoCatalogo(v, etiqueta);
  if (invalido) return rechazar(v.length > LARGO_MAXIMO_TEXTO_CATALOGO ? "largo" : "caracteres", invalido);
  if (!RE_ALFANUMERICO.test(v)) return rechazar("sin_alfanumerico", `${etiqueta} tiene que tener al menos una letra o un número.`);
  return aceptar(v);
}
