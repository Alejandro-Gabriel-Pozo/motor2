import type { Resultado } from "./validaciones";

/**
 * Nombre público de la empresa en la carta (`docs/diseno-nombre-publico-de-la-empresa-en-la-carta-2026-11-14.md`, F3): el texto que sale junto al nombre de la carta en el título de la pestaña, en
 * las descripciones y en la vista previa al compartir. PURO, sin Prisma: lo usan el catálogo del portal (al guardar y al leer) y el editor.
 *
 * Es una lista de PERMITIDOS (regla «todo nace cerrado», 2026-11-11): letras, marcas combinantes, números, puntuación, símbolos de moneda, modificadores y otros símbolos, los pocos símbolos matemáticos `+=|~¬±×÷`, espacio y espacio duro. `<` y `>` no entran (por eso no se admite todo el grupo de símbolos matemáticos: `<` y `>` son de ese grupo). Los
 * controles, los caracteres de ancho cero, los de dirección de texto y los separadores de línea no entran. Se guarda normalizado a NFC (misma forma que `nombre_visible` de Pedernal) y recortado.
 */
export const LARGO_MAXIMO_NOMBRE_PUBLICO = 60;

const RE_NOMBRE_PUBLICO = /^[\p{L}\p{M}\p{N}\p{P}\p{Sc}\p{Sk}\p{So}+=|~¬±×÷ \u00a0]+$/u;

export function validarNombrePublico(valor: unknown): Resultado<string> {
  if (typeof valor !== "string") return { ok: false, mensaje: "tiene que ser texto" };
  const v = valor.trim().normalize("NFC");
  if (!v) return { ok: false, mensaje: "no puede estar vacío" };
  if (v.length > LARGO_MAXIMO_NOMBRE_PUBLICO) return { ok: false, mensaje: `no puede superar los ${LARGO_MAXIMO_NOMBRE_PUBLICO} caracteres` };
  if (!RE_NOMBRE_PUBLICO.test(v)) return { ok: false, mensaje: "tiene caracteres no permitidos (saltos de línea, tabulaciones, caracteres invisibles, < o >…)" };
  return { ok: true, valor: v };
}
