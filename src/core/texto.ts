// Port directo de las utilidades de texto de Core.js (texto_/textoUpper_/
// mismoTexto_/validarTextoCatalogo_) — mismo comportamiento, sin cambios de
// criterio.

export function texto(v: unknown): string {
  return String(v ?? "").trim();
}

const RE_SUSTITUTOS = /[\uD800-\uDFFF]/;

/**
 * Saca del texto lo que Postgres no puede recibir: el NUL (`\u0000`, error 22021 «invalid byte sequence») y los sustitutos UTF-16 sueltos (una mitad de un emoji sin su pareja: no es
 * texto válido y Prisma rechaza la consulta al serializarla). Los pares completos (emojis) y todo el resto del texto —acentos, ñ, saltos de línea— quedan tal cual. Sin esos
 * caracteres la consulta no llega a fallar, así que una búsqueda con ellos devuelve «sin resultados» (o los de lo que sí era texto) en vez de un 500.
 */
export function quitarCaracteresInadmisibles(v: string): string {
  if (!v.includes("\u0000") && !RE_SUSTITUTOS.test(v)) return v; // lo normal: sin copias ni recorridos
  let salida = "";
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c === 0) continue;
    if (c >= 0xd800 && c <= 0xdbff) {
      const siguiente = v.charCodeAt(i + 1);
      if (siguiente >= 0xdc00 && siguiente <= 0xdfff) {
        salida += v[i] + v[i + 1];
        i++;
      }
      continue; // un sustituto alto sin su bajo: suelto
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue; // un sustituto bajo sin su alto: suelto
    salida += v[i];
  }
  return salida;
}

/**
 * El texto listo para un `contains` (LIKE/ILIKE) que lo busque TAL CUAL: escapa la barra invertida, el `%` y el `_`, que en un patrón de LIKE son el escape y los comodines. Prisma arma
 * el patrón como `%<texto>%` y NO los escapa, así que sin esto buscar `%` devolvía todo, `pan_i` encontraba también «Pan integral» y una barra invertida escapaba el `%` final.
 * (La barra va primero: si no, se escaparía la que acabamos de agregar.) Es solo para buscar con `contains`; no cambia lo que se guarda.
 */
export function escaparComodinesLike(v: string): string {
  return v.replace(/[\\%_]/g, "\\$&");
}

/**
 * El texto que se le pasa a Postgres en una BÚSQUEDA (`contains`, `ILIKE`, un filtro por identificador que viene de la URL o del cliente): `texto()` más sacar lo que Postgres no recibe.
 * Es el ÚNICO lugar donde se hace; toda lectura con un texto de búsqueda pasa por acá. Es solo para buscar: lo que se GUARDA (nombres, motivos…) sigue pasando por `texto()` y por su
 * validador, que rechaza esos caracteres con un mensaje claro en vez de borrarlos en silencio.
 */
export function textoDeBusqueda(v: unknown): string {
  return texto(quitarCaracteresInadmisibles(String(v ?? "")));
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
