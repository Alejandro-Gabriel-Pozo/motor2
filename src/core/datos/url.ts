/**
 * Un solo criterio para las direcciones web `https://` que carga el comercio (imágenes de la carta, links de redes, imagen para compartir): paso 4 de la auditoría 2026-11-12, regla «todo nace
 * cerrado» (AGENTS.md 2026-11-11). Declara lo PERMITIDO, no lo prohibido. Antes había tres copias («cualquier cosa menos espacios, comillas, paréntesis y `<>`»; en una solo «sin espacios»).
 *
 * Forma permitida: `https://` + dominio (letras, números, puntos y guiones; sin usuario ni contraseña delante, que es la forma de disfrazar un destino: `https://banco.com@otro.com`) +
 * puerto opcional + camino, consulta y fragmento opcionales con los caracteres de una dirección web SIN escapar (letras, números y `- . _ ~ : / ? # @ ! $ & * + , ; = %`). Todo lo demás debe ir
 * escrito con `%`: las letras no ASCII, las llaves, la barra vertical, el acento circunflejo. Las comillas, los paréntesis, los corchetes, la barra invertida, `<`, `>`, el acento grave y los
 * espacios no entran (la carta arma `url(…)` en CSS con la dirección sin escapar).
 */
const RE_URL_HTTPS_PERMITIDA = /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?(?:[/?#][A-Za-z0-9\-._~:/?#@!$&*+,;=%]*)?$/i;

/** `true` si `valor` (tal cual, sin recortar) es una dirección `https://` de la forma permitida. */
export function esUrlHttpsPermitida(valor: string): boolean {
  return RE_URL_HTTPS_PERMITIDA.test(valor);
}
