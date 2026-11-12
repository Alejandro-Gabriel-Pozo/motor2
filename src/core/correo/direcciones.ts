/**
 * Lo PERMITIDO en una dirección de correo (regla «Todo nace cerrado»): una parte local de letras, números y `. _ % + -` (hasta 64), una `@` y un dominio de etiquetas de letras, números y `-` separadas
 * por puntos (al menos dos etiquetas, cada una de hasta 63 y sin empezar ni terminar con `-`). Solo ASCII: un dominio con eñe o acentos llega en punycode. Todo lo demás (espacios, comillas, comas,
 * paréntesis, `<>`, caracteres de control, caracteres fuera de ASCII) no es una dirección.
 */
const DIRECCION = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const REMITENTE_CON_NOMBRE = /^([\p{L}\p{M}\p{N} .,&'()_-]+)<([A-Za-z0-9._%+@-]+)>$/u;
const LARGO_MAXIMO_DE_DIRECCION = 254;

/** Una dirección sola (`ana@ejemplo.com`): sin nombre, sin saltos de línea ni separadores. */
export function esDireccionValida(texto: string): boolean {
  return texto.length <= LARGO_MAXIMO_DE_DIRECCION && DIRECCION.test(texto);
}

function direccionDelRemitente(remitente: string): string | null {
  const texto = remitente.trim();
  const conNombre = REMITENTE_CON_NOMBRE.exec(texto);
  const direccion = conNombre ? conNombre[2] : texto;
  return esDireccionValida(direccion) ? direccion : null;
}

/** El remitente de un canal: `ana@ejemplo.com` o `Nombre <ana@ejemplo.com>`. */
export function esRemitenteValido(texto: string): boolean {
  return direccionDelRemitente(texto) !== null;
}

/** El dominio del remitente en minúsculas, o `null` si no es un remitente válido. */
export function dominioDelRemitente(remitente: string): string | null {
  const direccion = direccionDelRemitente(remitente);
  return direccion ? direccion.slice(direccion.indexOf("@") + 1).toLowerCase() : null;
}
