/**
 * ORÁCULO de la regla de texto de catálogo (`src/core/datos/texto-de-catalogo.ts` y `fichas-de-texto.ts`), escrito APARTE del código y a mano: lo que Pedernal
 * acepta y rechaza (AGENTS.md, «Combinaciones»; «Paridad con Pedernal»). Nada de esto se calcula con la regla: cada caso es un literal.
 *
 * DIMENSIONES cuyas combinaciones cambian lo que una persona puede guardar: la ficha (largo máximo, si exige una letra, si suma `¿ ¡ ? ! % $`) × el
 * texto (carácter permitido o no, normalización, `+`/`-` inicial, largo, letra). `test/arquitectura/texto-de-catalogo-declarado.test.ts` falla si aparece una
 * ficha, una opción de las reglas, un motivo o una función exportada que no esté declarada acá.
 */
export type Ficha = "PRODUCTO" | "ELECCION" | "RAZON_SOCIAL" | "NOMBRE_DE_COCINA" | "NOMBRE_DE_SUCURSAL" | "NOMBRE_DE_ROL";
export const FICHAS: readonly Ficha[] = ["PRODUCTO", "ELECCION", "RAZON_SOCIAL", "NOMBRE_DE_COCINA", "NOMBRE_DE_SUCURSAL", "NOMBRE_DE_ROL"];

/** Lo que cada ficha declara (Pedernal: `nombre-de-producto.ts`, `nombre-de-eleccion.ts`, `nombre-o-razon-social.ts`). */
export const DECLARACION_DE_FICHAS: Readonly<Record<Ficha, Readonly<{ maximo: number; exigirUnaLetra: boolean; conSignosDeCatalogo: boolean }>>> = {
  PRODUCTO: { maximo: 120, exigirUnaLetra: true, conSignosDeCatalogo: true },
  ELECCION: { maximo: 80, exigirUnaLetra: false, conSignosDeCatalogo: true },
  RAZON_SOCIAL: { maximo: 200, exigirUnaLetra: true, conSignosDeCatalogo: false },
  NOMBRE_DE_COCINA: { maximo: 80, exigirUnaLetra: true, conSignosDeCatalogo: false },
  NOMBRE_DE_SUCURSAL: { maximo: 80, exigirUnaLetra: true, conSignosDeCatalogo: false },
  NOMBRE_DE_ROL: { maximo: 80, exigirUnaLetra: true, conSignosDeCatalogo: false },
};

/** Las funciones con nombre de `fichas-de-texto.ts` y la ficha a la que responde cada una. */
export const FUNCIONES_POR_FICHA: Readonly<Record<string, Ficha>> = {
  nombreDeProductoDesdeTexto: "PRODUCTO",
  nombreDeEleccionDesdeTexto: "ELECCION",
  nombreODenominacionDesdeTexto: "RAZON_SOCIAL",
  nombreDeCocinaDesdeTexto: "NOMBRE_DE_COCINA",
  nombreDeSucursalDesdeTexto: "NOMBRE_DE_SUCURSAL",
  nombreDeRolDesdeTexto: "NOMBRE_DE_ROL",
};

/** Las otras funciones exportadas de `fichas-de-texto.ts`, declaradas para que una nueva no pase sin mirar. */
export const OTRAS_FUNCIONES_DE_FICHAS = ["textoDeFichaDesdeTexto", "claveDeNombre"] as const;

/** Lo exportado por `texto-de-catalogo.ts` (nombres): una opción o función nueva se declara acá. */
export const EXPORTADOS_DE_TEXTO_DE_CATALOGO = ["MotivoDeTextoInvalido", "ReglasDelTexto", "textoDeUnaLineaDesdeTexto"] as const;

/** Las opciones de `ReglasDelTexto` (cada una cambia qué se acepta). */
export const OPCIONES_DE_LAS_REGLAS = ["maximo", "exigirUnaLetra", "conSignosDeCatalogo"] as const;

/** Los motivos de rechazo, cerrados. Cada uno aparece en alguna fila de `FILAS`. */
export const MOTIVOS = ["VACIO", "DEMASIADO_LARGO", "CARACTER_PROHIBIDO", "SIN_LETRAS"] as const;

// --- El conjunto permitido, carácter por carácter (literales) ---------------------------------------------------------------------------------------
const LETRAS_ASCII = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const LETRAS_LATINAS = "ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿŠšŒœŽžŸ";
const DIGITOS = "0123456789";
/** Los signos de todo dato, y el espacio. */
const SIGNOS_BASE = " .,&-'/()°+:;\"#ºª’“”–—«»®™";
export const SIGNOS_SOLO_DE_CATALOGO = "¿¡?!%$";

export const LETRAS = LETRAS_ASCII + LETRAS_LATINAS;
export const PERMITIDOS_BASE = LETRAS + DIGITOS + SIGNOS_BASE;
export const PERMITIDOS_DE_CATALOGO = PERMITIDOS_BASE + SIGNOS_SOLO_DE_CATALOGO;

/**
 * Caracteres del plano básico que la regla acepta SIN estar en las listas de arriba, y por qué (el barrido de `texto-de-catalogo.oraculo.test.ts` los
 * recorre todos): son espacios que se colapsan a un espacio, o equivalentes canónicos (NFC) de un carácter permitido.
 */
export const ACEPTADOS_POR_NORMALIZACION: ReadonlyArray<Readonly<{ caracter: string; queda: string; motivo: string }>> = [
  { caracter: "\u00a0", queda: " ", motivo: "espacio de no corte: se colapsa a un espacio" },
  { caracter: "\u1680", queda: " ", motivo: "espacio ogham: se colapsa a un espacio" },
  { caracter: "\u2000", queda: " ", motivo: "en quad: NFC lo pasa a U+2002 y se colapsa a un espacio" },
  { caracter: "\u2001", queda: " ", motivo: "em quad: NFC lo pasa a U+2003 y se colapsa a un espacio" },
  { caracter: "\u2002", queda: " ", motivo: "en space: se colapsa a un espacio" },
  { caracter: "\u2003", queda: " ", motivo: "em space: se colapsa a un espacio" },
  { caracter: "\u2004", queda: " ", motivo: "espacio de un tercio: se colapsa a un espacio" },
  { caracter: "\u2005", queda: " ", motivo: "espacio de un cuarto: se colapsa a un espacio" },
  { caracter: "\u2006", queda: " ", motivo: "espacio de un sexto: se colapsa a un espacio" },
  { caracter: "\u2007", queda: " ", motivo: "espacio de cifra: se colapsa a un espacio" },
  { caracter: "\u2008", queda: " ", motivo: "espacio de puntuación: se colapsa a un espacio" },
  { caracter: "\u2009", queda: " ", motivo: "espacio fino: se colapsa a un espacio" },
  { caracter: "\u200a", queda: " ", motivo: "espacio muy fino: se colapsa a un espacio" },
  { caracter: "\u202f", queda: " ", motivo: "espacio fino de no corte: se colapsa a un espacio" },
  { caracter: "\u205f", queda: " ", motivo: "espacio matemático medio: se colapsa a un espacio" },
  { caracter: "\u3000", queda: " ", motivo: "espacio ideográfico: se colapsa a un espacio" },
  { caracter: ";", queda: ";", motivo: "signo de interrogación griego: NFC lo pasa a «;»" },
  { caracter: "K", queda: "K", motivo: "signo Kelvin: NFC lo pasa a «K»" },
  { caracter: "Å", queda: "Å", motivo: "signo Ångström: NFC lo pasa a «Å»" },
];

// --- Las filas: texto → resultado por ficha, escrito a mano ------------------------------------------------------------------------------------------
/** `"="`: el valor es el mismo texto de entrada. `"!CAR"`, `"!LARGO"`, `"!VACIO"`, `"!LETRA"`: el rechazo. Cualquier otro texto: el valor canónico. */
export type Esperado = string;
export type Fila = Readonly<{ texto: string; esperado: Readonly<Record<Ficha, Esperado>> }>;

// El nombre de cocina, el de sucursal y el de rol se comportan como la razón social en cada fila (exigen una letra y NO admiten `¿ ¡ ? ! % $`); solo cambia el largo máximo (80), que está en los casos de largo.
const fila = (texto: string, producto: Esperado, eleccion: Esperado = producto, razon: Esperado = eleccion, cocina: Esperado = razon): Fila => ({
  texto,
  esperado: { PRODUCTO: producto, ELECCION: eleccion, RAZON_SOCIAL: razon, NOMBRE_DE_COCINA: cocina, NOMBRE_DE_SUCURSAL: cocina, NOMBRE_DE_ROL: cocina },
});

export const FILAS: readonly Fila[] = [
  // Lo normal, con tildes, ñ y diéresis.
  fila("Café con leche", "="),
  fila("Ñandú", "="),
  fila("Pingüino", "="),
  fila("ÀÁÂÃÄÅÆÇ ÈÉÊË ÌÍÎÏ ÐÑ ÒÓÔÕÖØ ÙÚÛÜ Ýß àáâãäåæç èéêë ìíîï ðñ òóôõöø ùúûü ýÿ", "="),
  fila("Š š Œ œ Ž ž Ÿ", "="),
  fila("Pérez & Hijos S.A.", "="),
  fila("D'Angelo", "="),
  fila("La 5ta. SRL", "="),
  fila("Hotel 9 de Julio", "="),
  fila("Pizza 40 cm (grande) a/b: 1,5", "="),
  fila("a;b #1 \"x\"", "="),
  fila("º ª ° ® ™ « » ’ “ ” – — x", "="),
  fila("Kota+ A-B", "="),
  // Normalización: extremos, espacios, NFC.
  fila("  Café   con\u00a0leche  ", "Café con leche"),
  fila("Juan\n", "Juan"),
  fila("\tJuan\t", "Juan"),
  fila("\r\nJuan \r\n", "Juan"),
  fila("a\u2003\u2009b", "a b"),
  fila("Café", "Café"),
  fila("ña", "ña"),
  fila("Å", "Å"),
  // Vacío.
  fila("", "!VACIO"),
  fila("   ", "!VACIO"),
  fila("\n", "!VACIO"),
  fila("\u00a0", "!VACIO"),
  // Letra: los fichas con signos de catálogo y sin ellos se separan en los casos que lo muestran.
  fila("12", "!LETRA", "=", "!LETRA"),
  fila("2x1", "="),
  fila("30-71234567-1", "!LETRA", "=", "!LETRA"),
  fila("() .", "!LETRA", "=", "!LETRA"),
  fila("º ª", "!LETRA", "=", "!LETRA"),
  // Los signos de catálogo solo en el catálogo.
  fila("¿Querés papas?", "=", "=", "!CAR"),
  fila("Combo 2x1 50% $500", "=", "=", "!CAR"),
  fila("¡Hola!", "=", "=", "!CAR"),
  // Alfabetos no latinos, guion bajo, otros símbolos.
  fila("Pan_integral", "!CAR"),
  fila("Привет", "!CAR"),
  fila("小林商事", "!CAR"),
  fila("שלום", "!CAR"),
  fila("مرحبا", "!CAR"),
  fila("Ελληνικά", "!CAR"),
  fila("Łódź SA", "!CAR"),
  fila("Juan 😀", "!CAR"),
  fila("😀", "!CAR"),
  fila("Pan × 2", "!CAR"),
  fila("Pan ÷ 2", "!CAR"),
  fila("µ", "!CAR"),
  fila("Ａ", "!CAR"),
  fila("①", "!CAR"),
  fila("x²", "!CAR"),
  fila("‘x’", "!CAR"),
  fila("A…", "!CAR"),
  fila("100€", "!CAR"),
  fila("a|b", "!CAR"),
  fila("a*b", "!CAR"),
  fila("a\\b", "!CAR"),
  fila("a`b", "!CAR"),
  fila("a~b", "!CAR"),
  fila("a[b]", "!CAR"),
  fila("a{b}", "!CAR"),
  fila("a^b", "!CAR"),
  // Controles, invisibles, marcado, fórmulas.
  fila("Juan\nPérez", "!CAR"),
  fila("Juan\tPérez", "!CAR"),
  fila("Juan\rPérez", "!CAR"),
  fila("a\u0000b", "!CAR"),
  fila("a\u007fb", "!CAR"),
  fila("a\u0085b", "!CAR"),
  fila("a\u2028b", "!CAR"),
  fila("a\u2029b", "!CAR"),
  fila("Juan\u200bPérez", "!CAR"),
  fila("Juan\u200dPérez", "!CAR"),
  fila("Juan\u00adPérez", "!CAR"),
  fila("\u202eabc", "!CAR"),
  fila("\u2066abc", "!CAR"),
  // El marcador de orden de bytes en un EXTREMO lo recorta `trim` (es espacio para JavaScript); adentro se rechaza.
  fila("\ufeffabc", "abc"),
  fila("abc\ufeff", "abc"),
  fila("a\ufeffb", "!CAR"),
  fila("<b>Juan</b>", "!CAR"),
  fila("a<b", "!CAR"),
  fila("a>b", "!CAR"),
  fila("=SUM(1,2)", "!CAR"),
  fila("a=b", "!CAR"),
  fila("@usuario", "!CAR"),
  fila("a@b", "!CAR"),
  fila("+Kota", "!CAR"),
  fila("-Kota", "!CAR"),
  fila("  -Kota", "!CAR"),
  fila("+1", "!CAR"),
  // Orden de los motivos: el carácter prohibido antes que el largo y que la falta de letras.
  fila("<12>", "!CAR"),
  fila("😀".repeat(300), "!CAR"),
];

/** Largos límite: para cada ficha, un texto de `maximo` letras entra y uno de `maximo + 1` no. Las letras están escritas, no calculadas, con `repeat`. */
export const LETRA_DE_LOS_LARGOS = "A";
/** Una pieza de dos puntos de código en NFC que cuenta UNO por carácter canónico: «é» escrita en dos piezas. */
export const E_EN_DOS_PIEZAS = "é";
