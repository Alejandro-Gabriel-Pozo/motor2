/**
 * Un solo validador de dirección de correo para todo el sistema (paso 3 de la auditoría 2026-11-12; regla «todo nace cerrado», AGENTS.md 2026-11-11): declara lo PERMITIDO, no lo prohibido.
 * Antes había tres copias con criterios distintos (`limites.ts`, `primer-admin.ts` y `correo/direcciones.ts`), todas por «cualquier cosa menos espacios y @» o «menos estos separadores».
 *
 * Forma permitida (la práctica corriente de RFC 5321, sin comillas, comentarios ni dominios entre corchetes):
 *  - parte local: caracteres ASCII de la lista de abajo, separados por puntos únicos (sin punto al principio, al final ni dos seguidos), hasta 64 caracteres;
 *  - dominio: dos o más etiquetas separadas por puntos; cada etiqueta con letras, números y guiones (sin guion al principio ni al final), hasta 63 caracteres; un dominio con letras
 *    no ASCII se escribe en su forma `xn--…` (punycode);
 *  - la dirección entera, hasta 254 caracteres.
 * Sin espacios, saltos de línea, comillas dobles, `<`, `>`, `,`, `;`, `(`, `)`, `[`, `]` ni barra invertida: no hay forma de colar un segundo destinatario ni un encabezado.
 */
const LARGO_MAXIMO_DE_UN_EMAIL = 254;
const LARGO_MAXIMO_PARTE_LOCAL = 64;
const RE_PARTE_LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const RE_ETIQUETA_DE_DOMINIO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** `true` si `valor` (tal cual, sin recortar) es una dirección de correo de la forma permitida. */
export function esEmailValido(valor: string): boolean {
  if (valor.length > LARGO_MAXIMO_DE_UN_EMAIL) return false;
  const arroba = valor.indexOf("@");
  if (arroba < 1 || arroba !== valor.lastIndexOf("@")) return false;
  const parteLocal = valor.slice(0, arroba);
  if (parteLocal.length > LARGO_MAXIMO_PARTE_LOCAL || !RE_PARTE_LOCAL.test(parteLocal)) return false;
  const etiquetas = valor.slice(arroba + 1).split(".");
  return etiquetas.length >= 2 && etiquetas.every((etiqueta) => RE_ETIQUETA_DE_DOMINIO.test(etiqueta));
}
