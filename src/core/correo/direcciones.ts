import { esEmailValido } from "@/core/datos/email";

/** «Nombre <dirección>»: el nombre admite letras, marcas, números, espacio y `. , & ' ( ) _ -`; lo de entre `<>` solo caracteres de una dirección (la forma exacta la decide `esEmailValido`). */
const REMITENTE_CON_NOMBRE = /^([\p{L}\p{M}\p{N} .,&'()_-]+)<([A-Za-z0-9!#$%&'*+/=?^_`{|}~.@-]+)>$/u;

/** Una dirección sola (`ana@ejemplo.com`): sin nombre, sin saltos de línea ni separadores. */
export function esDireccionValida(texto: string): boolean {
  return esEmailValido(texto);
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
