import { aceptar, rechazar, type ResultadoDato } from "./resultado";

/**
 * Parser ESTRICTO de un número tecleado en es-AR (reemplaza al `normalizar` que tenía CampoNumero, que borraba en silencio todo lo
 * que no fuera dígito o separador: "1e3" daba 13, "5-3" daba 53, "1,2,3" daba 1,23 y "1.000.000" daba NaN → 0).
 *
 * Reglas (tabla completa en docs/plan-validacion-de-datos-2026-09-25.md):
 *  - Recorta espacios; vacío → `null` (campo sin cargar, NO es 0).
 *  - Un solo `-` al inicio (si el signo está permitido lo decide cada validador). Cualquier otro carácter que no sea dígito, `,` o `.`
 *    (`$`, espacios internos, `e`, `+`, `%`, `Infinity`) es error de formato.
 *  - Un solo separador es el DECIMAL, sea coma o punto ("1,5" = "1.5" = 1,5; "1.234" = 1,234 a propósito — si es un importe, lo frena la
 *    regla de 2 decimales).
 *  - El mismo separador repetido es de MILES y tiene que agrupar bien: el primer grupo de 1 a 3 dígitos, SIN ceros a la izquierda
 *    (un número con miles no empieza con 0), y los siguientes de 3 ("1.000.000" = 1000000; "1,2,3", "1.2.3", "12.34.5" y "1.5000.02"
 *    son error; "0.021.500" y "0.021,5" también: es lo que queda al tipear «1.500» o «1,5» detrás de un «0.02» que no se reemplazó,
 *    y leerlo como 21500 o 21,5 guardaba otro número). Sin miles, los ceros a la izquierda siguen valiendo ("007" = 7, "0,30" = 0,3).
 *  - Con los dos separadores, el último es el decimal (una sola vez) y el otro tiene que ser una agrupación de miles válida
 *    ("1.234,56" = "1,234.56" = 1234,56; "1.23,4" es error).
 *  - Acepta ",5" y "5," (tecleo a medias).
 */
const MENSAJE_NUMERO_INVALIDO = "No es un número válido.";

const RE_GRUPO_INICIAL = /^[1-9]\d{0,2}$/;
const RE_GRUPO_MILES = /^\d{3}$/;

function agrupacionDeMilesValida(partes: string[]): boolean {
  return RE_GRUPO_INICIAL.test(partes[0]) && partes.slice(1).every((p) => RE_GRUPO_MILES.test(p));
}

/** Parte entera y decimal (solo dígitos) del texto sin signo, o null si el formato no es válido. */
function separar(cuerpo: string): { entero: string; decimal: string } | null {
  if (!/^[\d.,]*$/.test(cuerpo) || !/\d/.test(cuerpo)) return null;
  const comas = cuerpo.split(",").length - 1;
  const puntos = cuerpo.split(".").length - 1;

  if (comas === 0 && puntos === 0) return { entero: cuerpo, decimal: "" };

  if (comas === 0 || puntos === 0) {
    const sep = comas > 0 ? "," : ".";
    const partes = cuerpo.split(sep);
    if (partes.length === 2) return { entero: partes[0], decimal: partes[1] };
    return agrupacionDeMilesValida(partes) ? { entero: partes.join(""), decimal: "" } : null;
  }

  const sepDecimal = cuerpo.lastIndexOf(",") > cuerpo.lastIndexOf(".") ? "," : ".";
  const sepMiles = sepDecimal === "," ? "." : ",";
  const partes = cuerpo.split(sepDecimal);
  if (partes.length !== 2) return null;
  const [conMiles, decimal] = partes;
  if (decimal.includes(sepMiles)) return null;
  const grupos = conMiles.split(sepMiles);
  if (!agrupacionDeMilesValida(grupos)) return null;
  return { entero: grupos.join(""), decimal };
}

export function interpretarNumero(texto: string): ResultadoDato<number | null> {
  const t = String(texto ?? "").trim();
  if (!t) return aceptar(null);
  const negativo = t.startsWith("-");
  const partes = separar(negativo ? t.slice(1) : t);
  if (!partes) return rechazar("formato", MENSAJE_NUMERO_INVALIDO);
  const n = Number(`${negativo ? "-" : ""}${partes.entero || "0"}${partes.decimal ? `.${partes.decimal}` : ""}`);
  if (!Number.isFinite(n)) return rechazar("formato", MENSAJE_NUMERO_INVALIDO);
  return aceptar(n === 0 ? 0 : n); // nunca -0
}

/**
 * Texto canónico de un número: dígitos, un solo punto decimal, sin notación exponencial ni separador de miles. Es lo que CampoNumero
 * emite hacia el formulario, así volver a interpretarlo nunca es ambiguo (`interpretarNumero(textoCanonico(n)) === n`).
 */
export function textoCanonico(n: number): string {
  if (n === 0) return "0";
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const [, signo, entero, decimal = "", exp] = m;
  const digitos = entero + decimal;
  const posicionPunto = entero.length + Number(exp);
  if (posicionPunto <= 0) return `${signo}0.${"0".repeat(-posicionPunto)}${digitos}`;
  if (posicionPunto >= digitos.length) return `${signo}${digitos}${"0".repeat(posicionPunto - digitos.length)}`;
  return `${signo}${digitos.slice(0, posicionPunto)}.${digitos.slice(posicionPunto)}`;
}

/**
 * Lo que un formulario le manda a la Server Action a partir del valor que EMITIÓ un CampoNumero (el «canal de valor», `leerNumeroCanonico`): vacío → `undefined`, válido → el número,
 * inválido (o tecleado y marcado como no canónico) → `NaN`. Nunca 0 por un texto que no es número (lo que hacía `Number("")`), así el servidor lo rechaza. NO lee lo que la persona
 * tipea: eso es `interpretarNumeroTecleado`, con el contexto del campo.
 */
export function numeroDelCampo(texto: string): number | undefined {
  const r = leerNumeroCanonico(texto);
  if (!r.ok) return Number.NaN;
  return r.valor ?? undefined;
}

/**
 * true si `n` no tiene más de `decimales` decimales. Compara contra su propio redondeo, así 0.07 o 10.01 (que en binario no son
 * exactos) no fallan por ruido de punto flotante, y 1.005 con 2 decimales se rechaza.
 */
export function tieneALoSumoDecimales(n: number, decimales: number): boolean {
  const factor = 10 ** decimales;
  const abs = Math.abs(n);
  return Math.round(abs * factor) / factor === abs;
}

/**
 * Número de una entrada de tipo desconocido (Server Action, script, seed): `number` finito tal cual, texto por el parser es-AR,
 * `null`/`undefined`/texto vacío → `null`. Cualquier otra cosa (booleano, objeto, NaN, ±Infinity) es error de formato. Base común de
 * validarImporte y validarCantidad, que ponen su propio mensaje.
 */
export function numeroDeEntrada(valor: unknown): ResultadoDato<number | null> {
  if (valor === null || valor === undefined) return aceptar(null);
  if (typeof valor === "number") return Number.isFinite(valor) ? aceptar(valor === 0 ? 0 : valor) : rechazar("formato", MENSAJE_NUMERO_INVALIDO);
  if (typeof valor === "string") return interpretarNumero(valor);
  return rechazar("formato", MENSAJE_NUMERO_INVALIDO);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2c (decisiones-cerradas-2026-10-19: «REGLA NUMÉRICA FINAL — NOTACIÓN ARGENTINA»): el parser de lo que la PERSONA escribe, con el contexto del campo.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Para qué es el número que se está leyendo: cuántos decimales admite. Un importe admite 2; una cantidad, los de su unidad (`Unidad.decimales`); un porcentaje o un factor, los de su columna. El contexto
 * decide dos cosas: si «21.000» es miles o es ambiguo, y cuántas cifras decimales TECLEADAS se aceptan (las cuenta sobre el texto, no sobre el valor: «21,000» tiene 3 aunque valga 21).
 */
export interface ContextoNumerico {
  decimales: number;
}

/** Un importe en pesos: hasta 2 decimales (`DECIMALES_IMPORTE`, el de las columnas `Decimal(14,2)`). */
export const CONTEXTO_IMPORTE: ContextoNumerico = { decimales: 2 };

/** Una cantidad cuya unidad no se conoce: los 4 decimales de las columnas `Decimal(14,4)`, el máximo que admite el sistema. Con ese contexto «1.205» es ambiguo (error), nunca se adivina. */
export const CONTEXTO_CANTIDAD_SIN_UNIDAD: ContextoNumerico = { decimales: 4 };

/** El contexto de una cantidad en una unidad con `decimales` decimales. */
export function contextoDeCantidad(decimales: number): ContextoNumerico {
  return { decimales };
}

/** Con 3 o más decimales posibles, «1.205» puede ser 1,205 o 1205: no se adivina. Con menos, un punto con 3 cifras detrás solo puede ser miles. */
const DECIMALES_QUE_VUELVEN_AMBIGUO_EL_PUNTO = 3;

const RE_SOLO_SEPARADORES_Y_DIGITOS = /^[\d.,]*$/;

/** La coma es SIEMPRE el decimal; lo que va antes (si trae puntos) tiene que ser miles bien agrupados. */
function separarConComa(cuerpo: string): { entero: string; decimal: string; pistaDeMiles: string | null } | null {
  const partes = cuerpo.split(",");
  if (partes.length !== 2) return null; // dos comas: no hay forma de que sean decimales
  const [izquierda, derecha] = partes;
  if (derecha.includes(".")) return null; // un punto DESPUÉS de la coma no es miles ni decimal («1,234.56»)
  let entero = izquierda;
  if (izquierda.includes(".")) {
    const grupos = izquierda.split(".");
    if (!agrupacionDeMilesValida(grupos)) return null;
    entero = grupos.join("");
  }
  // «21,000»: casi seguro quiso decir veintiún mil. La pista se arma solo cuando el entero es de 1 a 3 cifras sin cero inicial y detrás hay EXACTAMENTE 3.
  const pistaDeMiles = !izquierda.includes(".") && RE_GRUPO_INICIAL.test(izquierda) && RE_GRUPO_MILES.test(derecha) ? `${izquierda}${derecha}` : null;
  return { entero, decimal: derecha, pistaDeMiles };
}

type SinComa = { entero: string; decimal: string } | { ambiguo: { entero: string; decimal: string } } | null;

/** Sin coma: el punto es miles (varios, o uno con exactamente 3 cifras que no admite lectura decimal) o decimal (uno con 1, 2 o 4 y más cifras, o con el entero en 0). */
function separarSinComa(cuerpo: string, contexto: ContextoNumerico): SinComa {
  const puntos = cuerpo.split(".").length - 1;
  if (puntos === 0) return { entero: cuerpo, decimal: "" };
  const partes = cuerpo.split(".");
  if (puntos >= 2) return agrupacionDeMilesValida(partes) ? { entero: partes.join(""), decimal: "" } : null;
  const [a, b] = partes;
  if (b === "") return { entero: a, decimal: "" }; // «21.»: tecleo a medias, se ignora el separador
  if (a === "") return { entero: "", decimal: b }; // «.5»
  if (b.length === 3 && RE_GRUPO_INICIAL.test(a)) {
    // «21.000» / «1.205»: miles o decimales. Si la unidad admite 3 o más decimales no se adivina.
    return contexto.decimales >= DECIMALES_QUE_VUELVEN_AMBIGUO_EL_PUNTO ? { ambiguo: { entero: a, decimal: b } } : { entero: a + b, decimal: "" };
  }
  return { entero: a, decimal: b };
}

/** El aviso de la regla del decimal: cuántos admite el contexto. */
function mensajeDeDecimales(contexto: ContextoNumerico, pistaDeMiles: string | null): string {
  const base = contexto.decimales === 0 ? "Tiene que ser un número entero." : `Admite como máximo ${contexto.decimales} ${contexto.decimales === 1 ? "decimal" : "decimales"}.`;
  return pistaDeMiles === null ? base : `${base} Para ${pistaDeMiles} escribí ${pistaDeMiles} o ${formatearMilesParaPista(pistaDeMiles)},00.`;
}

/** «21000» → «21.000» (para la pista: lo escrito con miles es la forma que el parser lee como 21000 en un importe). */
function formatearMilesParaPista(digitos: string): string {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/**
 * Lee lo que la PERSONA escribió en un campo numérico, con la notación argentina (decisión del dueño, 2026-10-20): coma decimal siempre; punto de miles bien agrupado; un solo punto con 1 o 2 cifras es decimal («21.5»);
 * un solo punto con 3 cifras («21.000», «1.205») es miles si el contexto admite menos de 3 decimales (importes y unidades chicas) y es AMBIGUO (error, no se adivina) si admite 3 o más; «0.125» es decimal; una coma seguida
 * de más cifras que los decimales del contexto es error de decimales («21,000» en un importe), contadas sobre lo tecleado. Un separador final sin cifras se ignora («5,», «21.»); «,5» y «.5» valen 0,5. Vacío → `null` (campo
 * sin cargar). Notación científica, símbolos, espacios y texto son error de formato; nada se borra en silencio ni se redondea.
 *
 * Errores: `formato` (no es un número), `ambiguo` («1.205» en kg: puede ser 1,205 o 1205) y `decimales` (más cifras decimales que las del contexto). Sirve igual en la pantalla y en el servidor.
 */
export function interpretarNumeroTecleado(texto: string, contexto: ContextoNumerico): ResultadoDato<number | null> {
  const t = String(texto ?? "").trim();
  if (!t) return aceptar(null);
  const negativo = t.startsWith("-");
  const cuerpo = negativo ? t.slice(1) : t;
  if (!RE_SOLO_SEPARADORES_Y_DIGITOS.test(cuerpo) || !/\d/.test(cuerpo)) return rechazar("formato", MENSAJE_NUMERO_INVALIDO);

  let entero: string;
  let decimal: string;
  let pistaDeMiles: string | null = null;
  if (cuerpo.includes(",")) {
    const separado = separarConComa(cuerpo);
    if (!separado) return rechazar("formato", MENSAJE_NUMERO_INVALIDO);
    ({ entero, decimal, pistaDeMiles } = separado);
  } else {
    const separado = separarSinComa(cuerpo, contexto);
    if (!separado) return rechazar("formato", MENSAJE_NUMERO_INVALIDO);
    if ("ambiguo" in separado) {
      const { entero: a, decimal: b } = separado.ambiguo;
      return rechazar("ambiguo", `¿${a},${b} o ${a}${b}? Escribí ${a}${b} o ${a},${b}.`);
    }
    ({ entero, decimal } = separado);
  }
  if (decimal.length > contexto.decimales) return rechazar("decimales", mensajeDeDecimales(contexto, contexto.decimales < DECIMALES_QUE_VUELVEN_AMBIGUO_EL_PUNTO ? pistaDeMiles : null));
  const n = Number(`${negativo ? "-" : ""}${entero || "0"}${decimal ? `.${decimal}` : ""}`);
  if (!Number.isFinite(n)) return rechazar("formato", MENSAJE_NUMERO_INVALIDO);
  return aceptar(n === 0 ? 0 : n); // nunca -0
}

/**
 * El «canal de valor» de un campo numérico: lo que `CampoNumero` EMITE y lo que los formularios y las bases le pasan de vuelta (`value`, `defaultValue`, el campo oculto): dígitos y UN punto decimal, sin separador de miles
 * ni exponente. No es lo que la persona tipea (eso lo lee `interpretarNumeroTecleado` con su contexto): «1.205» acá es 1,205, siempre. Estricto: cualquier otra cosa, y también el texto tecleado que
 * `marcarNoCanonico` dejó marcado, es error de formato. Vacío → `null`.
 */
const RE_CANONICO = /^-?\d+(\.\d+)?$/;

export function leerNumeroCanonico(texto: string): ResultadoDato<number | null> {
  const t = String(texto ?? "");
  if (t === "") return aceptar(null);
  if (!RE_CANONICO.test(t)) return rechazar("formato", MENSAJE_NUMERO_INVALIDO);
  const n = Number(t);
  if (!Number.isFinite(n)) return rechazar("formato", MENSAJE_NUMERO_INVALIDO);
  return aceptar(n === 0 ? 0 : n);
}

/** La marca que vuelve ilegible como canónico a un texto tecleado inválido: un carácter sin ancho, que `trim()` no saca y la regex del canal no acepta. */
export const MARCA_DE_NO_CANONICO = "\u200B";

/**
 * El texto que `CampoNumero` emite cuando lo tecleado NO es un número válido: el mismo texto, pero que nunca se pueda leer como canónico. Hace falta porque algo inválido puede PARECER canónico («1.205» en un campo de
 * kilos es ambiguo, y como canónico valdría 1,205): sin la marca, un formulario que lee el canal con `Number()` o con `leerNumeroCanonico` mandaría ese 1,205 en silencio.
 */
export function marcarNoCanonico(texto: string): string {
  return RE_CANONICO.test(texto) ? `${texto}${MARCA_DE_NO_CANONICO}` : texto;
}

/** Lo que se ve de un texto del canal: sin la marca (no se ve, pero tampoco tiene que viajar al lector). */
export function sinMarcaDeNoCanonico(texto: string): string {
  return texto.endsWith(MARCA_DE_NO_CANONICO) ? texto.slice(0, -MARCA_DE_NO_CANONICO.length) : texto;
}

/**
 * Un número como se le muestra a quien lo va a EDITAR: el texto canónico con la COMA como decimal y sin separador de miles («1,205», «21000»). Con la regla de la notación argentina se lee
 * siempre como el mismo número (el canónico con punto, «1.205», se leería como ambiguo en un campo de kilos).
 */
export function textoParaEscribir(n: number): string {
  return textoCanonico(n).replace(".", ",");
}

/**
 * El mensaje de un número tecleado que no se pudo leer, con el sujeto del campo cuando se lo conoce («El precio de venta admite como máximo 2 decimales. Para 100123 escribí 100123 o 100.123,00.»,
 * «El factor: ¿1,205 o 1205? Escribí 1205 o 1,205.», «La cantidad no es un número válido.»). Sin sujeto, el mensaje del parser tal cual. Lo usan el campo en pantalla y la validación del servidor.
 */
export function mensajeDeNumeroRechazado(rechazo: { codigo: string; mensaje: string }, sujeto?: string): string {
  if (!sujeto) return rechazo.mensaje;
  if (rechazo.codigo === "formato") return `${sujeto} no es un número válido.`;
  if (rechazo.codigo === "ambiguo") return `${sujeto}: ${rechazo.mensaje}`;
  return `${sujeto} ${rechazo.mensaje.charAt(0).toLowerCase()}${rechazo.mensaje.slice(1)}`;
}
