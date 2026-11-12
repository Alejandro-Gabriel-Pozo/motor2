/**
 * La FORMA de una URL `https://` que se acepta para una imagen de la carta (regla «Todo nace cerrado»: se declara lo que se PERMITE, no lo que se prohíbe). Solo caracteres ASCII de una URL
 * (letras, números y `- . _ ~ : / ? # @ ! $ & * + , ; = %`): sin espacios, comillas, paréntesis, corchetes, barras invertidas, `<>`, acento grave, caracteres de control ni caracteres fuera de ASCII
 * (una URL con acentos o un host con eñe llega codificada con `%XX`/punycode). La carta mete la URL en `url(${url})` sin escapar, así que lo que no figura acá no entra.
 */
const URL_HTTPS = /^https:\/\/[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+$/i;

/** ¿Tiene la forma de una URL `https://` con un host? (no mira que sea alcanzable ni que el host exista: eso lo decide quien la parsea). */
export function tieneFormaDeUrlHttps(texto: string): boolean {
  return URL_HTTPS.test(texto);
}
