// Port directo de las utilidades de texto de Core.js (texto_/textoUpper_/
// mismoTexto_/validarTextoCatalogo_) — mismo comportamiento, sin cambios de
// criterio.

export function texto(v: unknown): string {
  return String(v ?? "").trim();
}

export function textoUpper(v: unknown): string {
  return texto(v).toUpperCase();
}

/** Compara dos textos libres ignorando mayúsculas/espacios. */
export function mismoTexto(a: unknown, b: unknown): boolean {
  return texto(a).toLowerCase() === texto(b).toLowerCase();
}

/**
 * Charset permitido para nombres de catálogo (producto, proveedor,
 * categoría, familia, unidad, sección, rol, sucursal) — mismo criterio que
 * Core.js:675: letras (con tilde/ñ vía \p{L}), dígitos, espacio, y la
 * puntuación real de este dominio.
 */
export const RE_TEXTO_CATALOGO = /^[\p{L}\p{N} \-.,()%&/'_]+$/u;
export const LARGO_MAXIMO_TEXTO_CATALOGO = 80;

/**
 * null si `valor` es válido como nombre de catálogo, o el mensaje de error
 * listo para mostrar. No reemplaza el chequeo de "obligatorio" — un valor
 * vacío no es asunto de este validador (mismo criterio que Core.js:685).
 */
export function validarTextoCatalogo(valor: unknown, etiquetaCampo: string): string | null {
  const v = texto(valor);
  if (!v) return null;
  if (v.length > LARGO_MAXIMO_TEXTO_CATALOGO) {
    return `${etiquetaCampo} no puede superar los ${LARGO_MAXIMO_TEXTO_CATALOGO} caracteres.`;
  }
  if (!RE_TEXTO_CATALOGO.test(v)) {
    return `${etiquetaCampo} tiene caracteres no permitidos. Se admiten letras, números, espacios y - . , ( ) % & / '`;
  }
  // El "-" es el único disparador de fórmula de planilla (= + - @) que el charset de arriba deja pasar: un nombre
  // como "-A1" o "-SUM(1,2)" se evaluaría si se pega o se importa en una planilla. El export a Excel (src/core/excel.ts)
  // ya guarda los textos como texto: esto es defensa en profundidad.
  if (v.startsWith("-")) return `${etiquetaCampo} no puede empezar con "-".`;
  return null;
}
