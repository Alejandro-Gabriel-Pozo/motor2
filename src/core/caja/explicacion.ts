import { invalido, valido, type ResultadoDeRegla } from "@/core/datos/resultado-de-regla";

/**
 * FICHA DEL DATO: EXPLICACIÓN DEL CIERRE (Pedernal `src/modulos/cierre/dominio/explicacion.ts`; decisión 160 del dueño de Pedernal: «el texto es opcional»; e3b §3.2: 500). Lo que escribe quien cierra el día para explicar un hallazgo que reconoce,
 * la observación general de la jornada y el motivo de una corrección de medio o de un ajuste. Se guarda inmutable con la jornada cerrada.
 *
 * Cómo se escribe: una línea de 1 a `LARGO_MAXIMO_DE_LA_EXPLICACION` caracteres hecha SOLO de la lista de abajo (letras latinas con tilde y ñ, dígitos, espacio y los signos de una frase en castellano). Los extremos se recortan, el texto
 * pasa a NFC y los espacios repetidos quedan en uno; lo que no está en la lista se rechaza (saltos de línea y tabuladores adentro, invisibles, `<` y `>`, emojis): lista de permitidos, no de prohibidos (regla del dueño, 2026-11-11).
 * La lista y el tope los repiten los CHECK de la base (`JornadaDeSucursal_observacion_chk`, `ControlDeJornadaCerrada_texto_chk`, `CorreccionDeMedio_motivo_chk`); si cambia uno, cambia el otro.
 *
 * Puro: sin reloj, sin azar, sin I/O.
 */
const LARGO_MAXIMO_DE_LA_EXPLICACION = 500;

type ErrorDeExplicacion = "EXPLICACION_INVALIDA";

const LETRAS = "A-Za-zÀ-ÖØ-öø-ÿ";
const DIGITOS = "0-9";
const SIGNOS = ".,;:!?¿¡()/%$#&'\"°ºª+*_-";
const SOLO_PERMITIDOS = new RegExp(`^[${LETRAS}${DIGITOS} ${SIGNOS}]+$`);
const ESPACIOS_REPETIDOS = / {2,}/g;

/**
 * Deja la explicación en su forma canónica: `null` si no hay (omitida, `null` o en blanco); el texto recortado si es válido; si no, `EXPLICACION_INVALIDA`. Las letras con tilde se componen (NFC) ANTES de mirar la lista:
 * «é» de una o de dos piezas es el mismo texto.
 */
export function explicacionDesdeTexto(texto: string | null | undefined): ResultadoDeRegla<string | null, ErrorDeExplicacion> {
  if (texto === null || texto === undefined) return valido(null);
  const canonico = texto.trim().normalize("NFC").replace(ESPACIOS_REPETIDOS, " ");
  if (canonico === "") return valido(null);
  if (canonico.length > LARGO_MAXIMO_DE_LA_EXPLICACION || !SOLO_PERMITIDOS.test(canonico)) return invalido("EXPLICACION_INVALIDA");
  return valido(canonico);
}
