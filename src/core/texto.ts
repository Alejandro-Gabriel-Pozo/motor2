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
 * null si `valor` (ya no vacío) no supera `maximo` caracteres, o el mensaje
 * de error listo para mostrar. Vacío no es asunto de este validador (mismo
 * criterio que validarTextoCatalogo/Core.js:685) — lo obligatorio se valida
 * aparte.
 */
export function validarLargoTexto(valor: unknown, etiquetaCampo: string, maximo: number): string | null {
  const v = texto(valor);
  if (!v) return null;
  if (v.length > maximo) return `${etiquetaCampo} no puede superar los ${maximo} caracteres.`;
  return null;
}

/**
 * Número de factura del proveedor: texto libre (lo pone el proveedor en su
 * papel), sin charset propio — a diferencia de un nombre de catálogo, acá
 * `#`, `:`, `*` o un `-` inicial son perfectamente válidos. Solo se acota el
 * largo, para blindar contra un pegado accidental; 60 cubre con holgura
 * cualquier formato real (AFIP punto de venta + correlativo, o el de
 * cualquier proveedor) sin acercarse al límite de ningún referente.
 */
export const LARGO_MAXIMO_NRO_FACTURA = 60;

/**
 * Motivo de la anulación de un ítem de cuenta ya enviado a cocina (módulo POS, docs/plan-tomar-pedido-2026-09-25.md): texto
 * libre y obligatorio («el cliente cambió de idea», «salió mal de cocina»…). 200 alcanza para una frase explicativa sin
 * convertirlo en un campo de notas.
 */
export const LARGO_MAXIMO_MOTIVO_ANULACION = 200;

/**
 * null si `valor` es válido como nombre de catálogo, o el mensaje de error
 * listo para mostrar. No reemplaza el chequeo de "obligatorio" — un valor
 * vacío no es asunto de este validador (mismo criterio que Core.js:685).
 */
export function validarTextoCatalogo(valor: unknown, etiquetaCampo: string): string | null {
  const v = texto(valor);
  if (!v) return null;
  const errorLargo = validarLargoTexto(v, etiquetaCampo, LARGO_MAXIMO_TEXTO_CATALOGO);
  if (errorLargo) return errorLargo;
  if (!RE_TEXTO_CATALOGO.test(v)) {
    return `${etiquetaCampo} tiene caracteres no permitidos. Se admiten letras, números, espacios y - . , ( ) % & / '`;
  }
  // El "-" es el único disparador de fórmula de planilla (= + - @) que el charset de arriba deja pasar: un nombre
  // como "-A1" o "-SUM(1,2)" se evaluaría si se pega o se importa en una planilla. El export a Excel (src/core/excel.ts)
  // ya guarda los textos como texto: esto es defensa en profundidad.
  if (v.startsWith("-")) return `${etiquetaCampo} no puede empezar con "-".`;
  return null;
}
