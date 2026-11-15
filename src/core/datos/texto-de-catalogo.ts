import { invalido, valido, type ResultadoDeRegla } from "./resultado-de-regla";

/**
 * TEXTO DE UNA LÍNEA DE CATÁLOGO: la regla común de lo que se escribe como nombre (producto, sección, opción, proveedor, cliente…) y se imprime o se
 * muestra. Reproduce la de Pedernal (`src/primitivas/texto/texto-de-una-linea.ts`, versión vigente de `main`), en TypeScript y sin tocar la base.
 * Regla del dueño (AGENTS.md, «Paridad con Pedernal», 2026-11-13; «Sí, copiar a Pedernal en esas cinco», 2026-11-15) y «Todo nace cerrado»
 * (2026-11-11).
 *
 * LISTA DE PERMITIDOS: solo pasa lo declarado abajo; cualquier otro carácter se rechaza. Deja afuera, sin enumerarlos, los de control, los
 * invisibles y de dirección de texto, los separadores de línea, `<` y `>`, `_`, los emojis y los alfabetos no latinos (hebreo, árabe, cirílico,
 * ideogramas). Motivo escrito en Pedernal: lo que se acepta tiene que poder imprimirse en el PDF y en la pantalla con la tipografía estándar.
 *  · Letras: latinas con tilde, ñ y diéresis (Latin-1 sin `×` ni `÷`, más Š š Œ œ Ž ž Ÿ de WinAnsi), y dígitos.
 *  · Signos de todos los datos: espacio y `. , & - ' / ( ) ° + : ; " # º ª ’ “ ” – — « » ® ™`.
 *  · Signos SOLO del catálogo (`conSignosDeCatalogo`): `¿ ¡ ? ! % $` (nombres reales de una carta: «¿Querés papas?», «Combo 2x1 50% $500»).
 *    Razón social y demás datos que viajan a un comprobante siguen sin ellos.
 *  · Un texto no puede EMPEZAR con `+` ni `-` (abierto en una planilla se tomaría por una fórmula). `=` y `@` ya quedan afuera por no estar en la lista.
 *
 * Normalización, en este orden: recorta los extremos (saltos de línea y tabuladores en los extremos se recortan; adentro se rechazan); pasa a NFC
 * (la «é» de una o de dos piezas es el mismo texto); colapsa los espacios repetidos (también el de no corte y los tipográficos) a uno solo. Después:
 * lista de permitidos, `+`/`-` inicial, largo contado por carácter (un emoji cuenta uno, como `char_length` de Postgres) y, si se exige, al menos una letra
 * latina (dígitos, signos, `º` y `ª` no cuentan). Se informa antes el carácter no permitido, después el largo, después la falta de letras. Se conservan
 * mayúsculas y acentos tal cual.
 *
 * NO está conectada a ninguna pantalla ni acción todavía (etapa E1 del plan de paridad; antes de endurecer se cuenta cuántos nombres ya cargados la
 * romperían: `docs/e1-recuento-de-textos-y-cuit-2026-11-15.md`). Puro: sin reloj ni azar.
 */
export type MotivoDeTextoInvalido = "VACIO" | "DEMASIADO_LARGO" | "CARACTER_PROHIBIDO" | "SIN_LETRAS";

/** Letras latinas con tilde, ñ y diéresis: Latin-1 sin `×` ni `÷`, más las letras extra de WinAnsi (Š š Œ œ Ž ž Ÿ). */
const LETRAS = "A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ";
const DIGITOS = "0-9";
/** Los signos admitidos en todo dato, además del espacio. */
const SIGNOS = ".,&\\-'/()°+:;\"#ºª’“”–—«»®™";
/** Los que SOLO suma el texto de catálogo. */
const SIGNOS_DEL_CATALOGO = "¿¡?!%$";

// Sin la bandera `u` a propósito: todo lo permitido es del plano básico, así que un carácter de otro plano (un emoji) se rechaza igual, porque sus dos mitades no están en la lista.
const SOLO_PERMITIDOS = new RegExp(`^[${LETRAS}${DIGITOS} ${SIGNOS}]+$`);
const SOLO_PERMITIDOS_DE_CATALOGO = new RegExp(`^[${LETRAS}${DIGITOS} ${SIGNOS}${SIGNOS_DEL_CATALOGO}]+$`);
const UNA_LETRA = new RegExp(`[${LETRAS}]`);
const ESPACIOS = /\p{Zs}+/gu;
// Solo `+` y `-`: `=` y `@` ya los rechaza la lista de permitidos.
const EMPIEZA_COMO_FORMULA = /^[+-]/;

/** El largo en caracteres (un emoji cuenta uno), como `char_length` de Postgres. */
function largoEnCaracteres(texto: string): number {
  return [...texto].length;
}

/** Lo que cambia de un dato a otro: el largo máximo, si exige al menos una letra y si suma `¿ ¡ ? ! % $` a la lista base (por defecto no). */
export type ReglasDelTexto = Readonly<{
  maximo: number;
  exigirUnaLetra: boolean;
  conSignosDeCatalogo?: boolean;
}>;

/** Deja el texto en su forma canónica o dice por qué no sirve (ver el encabezado: orden de la normalización y de los motivos). */
export function textoDeUnaLineaDesdeTexto(texto: string, reglas: ReglasDelTexto): ResultadoDeRegla<string, MotivoDeTextoInvalido> {
  const canonico = texto.trim().normalize("NFC").replace(ESPACIOS, " ");
  if (canonico === "") return invalido("VACIO");
  const permitidos = reglas.conSignosDeCatalogo === true ? SOLO_PERMITIDOS_DE_CATALOGO : SOLO_PERMITIDOS;
  if (!permitidos.test(canonico)) return invalido("CARACTER_PROHIBIDO");
  if (EMPIEZA_COMO_FORMULA.test(canonico)) return invalido("CARACTER_PROHIBIDO");
  if (largoEnCaracteres(canonico) > reglas.maximo) return invalido("DEMASIADO_LARGO");
  if (reglas.exigirUnaLetra && !UNA_LETRA.test(canonico)) return invalido("SIN_LETRAS");
  return valido(canonico);
}
