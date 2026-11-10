import { aceptar, rechazar, type ResultadoDato } from "./resultado";

/**
 * Números tecleados y números de entrada (docs/plan-validacion-de-datos-2026-09-25.md; docs/diseno-campo-numerico-entrada-2026-11-09.md, regla de números del dueño, 2026-11-09). Tres lectores, porque el mismo
 * texto significa cosas distintas según quién lo escribió:
 *  - `interpretarNumeroTecleado(texto, contexto)`: lo que la PERSONA escribe o pega en un campo: dígitos y UNA coma decimal. El «.» NO existe en lo que se escribe (ni como miles ni como decimal): se rechaza con el aviso
 *    `AVISO_DEL_PUNTO`. El sistema agrega el punto de miles solo, al mostrar.
 *  - `leerNumeroCanonico(texto)`: el «canal de valor» de `CampoNumero` (dígitos y un punto decimal, formato de máquina).
 *  - `numeroDeEntrada(valor, contexto)`: lo que llega a la Server Action. Un texto se acepta ÚNICAMENTE en el formato canónico estricto (dígitos y un punto decimal, sin miles ni coma): un pedido armado a mano no cuela ambigüedad.
 * Pura: sin React, Prisma ni `server-only`.
 */
const MENSAJE_NUMERO_INVALIDO = "No es un número válido.";

const RE_GRUPO_INICIAL = /^[1-9]\d{0,2}$/;
const RE_GRUPO_MILES = /^\d{3}$/;
const RE_SOLO_SEPARADORES_Y_DIGITOS = /^[\d.,]*$/;

/**
 * Texto canónico de un número: dígitos, un solo punto decimal, sin notación exponencial ni separador de miles. Es lo que CampoNumero
 * emite hacia el formulario, así volver a leerlo nunca es ambiguo (`leerNumeroCanonico(textoCanonico(n))` da `n`).
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
 * El número de un valor que un formulario le manda a la Server Action como texto (o ya como `number`), leído como el servidor SIEMPRE lee: solo el formato canónico (dígitos y un punto decimal, sin miles ni coma,
 * sin exponente ni espacios). Lo que no lo es (o está vacío) es `NaN`, nunca un 0 ni una lectura adivinada: lo rechaza el validador con su mensaje. Es lo que reemplaza a `Number(texto)` en los validadores que leen `unknown`.
 */
export function numeroDeFormulario(valor: unknown): number {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : Number.NaN;
  if (typeof valor !== "string") return Number.NaN;
  const r = leerNumeroCanonico(valor);
  return r.ok && r.valor !== null ? r.valor : Number.NaN;
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
 * Número de una entrada de tipo desconocido (Server Action, script, seed), leída con el CONTEXTO del campo: `number` finito tal cual; texto SOLO en el formato canónico estricto (`^-?\d+(\.\d+)?$`: dígitos y un punto
 * decimal, sin miles, sin coma, sin espacios; es lo que `CampoNumero` manda por el campo oculto) y con a lo sumo los decimales del contexto, contados sobre el texto («21.000» en un importe son 3 decimales, no veintiún mil);
 * `null`/`undefined`/texto vacío o de solo espacios → `null`. Cualquier otra cosa (booleano, objeto, NaN, ±Infinity, «21,5», «1.234,50») es error de formato: el servidor no confía en el cliente ni adivina cómo lo escribió. Base común de
 * validarImporte, validarCantidad y los demás, que ponen su propio mensaje.
 */
export function numeroDeEntrada(valor: unknown, contexto: ContextoNumerico): ResultadoDato<number | null> {
  if (valor === null || valor === undefined) return aceptar(null);
  if (typeof valor === "number") return Number.isFinite(valor) ? aceptar(valor === 0 ? 0 : valor) : rechazar("formato", MENSAJE_NUMERO_INVALIDO);
  if (typeof valor !== "string") return rechazar("formato", MENSAJE_NUMERO_INVALIDO);
  if (valor.trim() === "") return aceptar(null); // vacío o solo espacios: sin valor (no hay nada que leer ni que adivinar)
  if (!RE_CANONICO.test(valor)) return rechazar("notacion", MENSAJE_NOTACION_DEL_SERVIDOR);
  const decimales = valor.includes(".") ? valor.length - valor.indexOf(".") - 1 : 0;
  if (decimales > contexto.decimales) return rechazar("decimales", mensajeDeDecimales(contexto));
  const n = Number(valor);
  return Number.isFinite(n) ? aceptar(n === 0 ? 0 : n) : rechazar("formato", MENSAJE_NUMERO_INVALIDO);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2c (decisiones-cerradas-2026-10-19: «REGLA NUMÉRICA FINAL — NOTACIÓN ARGENTINA»): el parser de lo que la PERSONA escribe, con el contexto del campo.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Cuántos decimales admite el número que se está leyendo: los de su unidad o su columna (un importe, 2; una cantidad entera, 0). Cuenta las cifras TECLEADAS, no el valor: «21,000» tiene 3 aunque valga 21.
 * Ya no hay un «tipo» que cambie la lectura: sin el punto de miles no existe el «21.000» que era miles en un importe y ambiguo en kilos.
 */
export interface ContextoNumerico {
  decimales: number;
}

/** Un importe en pesos: hasta 2 decimales (`DECIMALES_IMPORTE`, el de las columnas `Decimal(14,2)`). */
export const CONTEXTO_IMPORTE: ContextoNumerico = { decimales: 2 };

/** Una cantidad cuya unidad no se conoce: los 4 decimales de las columnas `Decimal(14,4)`, el máximo que admite el sistema. */
export const CONTEXTO_CANTIDAD_SIN_UNIDAD: ContextoNumerico = { decimales: 4 };

/** El contexto de una cantidad en una unidad con `decimales` decimales (también el de un porcentaje o un factor, con los de su columna). */
export function contextoDeCantidad(decimales: number): ContextoNumerico {
  return { decimales };
}

/** El aviso del «.»: lo que se le dice a la persona cuando teclea o pega un punto en un campo numérico (decisión del dueño, 2026-11-09). */
export const AVISO_DEL_PUNTO = "Los decimales van con coma: 0,5";

/** Lo que dice el servidor de un texto que no es el formato canónico (dígitos y un punto decimal). Un campo de pantalla nunca lo manda: es un pedido armado a mano. */
export const MENSAJE_NOTACION_DEL_SERVIDOR = "Formato de número no admitido (solo dígitos y un punto decimal, sin miles ni coma).";

/** «21,000»: casi seguro quiso decir veintiún mil. Las cifras juntas («21000») cuando el entero es de 1 a 3 dígitos sin cero inicial y detrás de la coma hay EXACTAMENTE 3; si no, `null`. */
function cifrasDeUnaPistaDeMiles(izquierda: string, derecha: string): string | null {
  return RE_GRUPO_INICIAL.test(izquierda) && RE_GRUPO_MILES.test(derecha) ? `${izquierda}${derecha}` : null;
}

/** La pista para un número tecleado con coma y tres cifras detrás («21,000» → «Para 21000 escribí 21000.»), o `null` si no corresponde. Sirve para los mensajes de decimales de los validadores. */
export function pistaDeMiles(texto: unknown): string | null {
  if (typeof texto !== "string") return null;
  // Sin regex con `\s*` pegado a `[^,]*` (ambiguo: cuadrático sobre un texto largo): se recorta, se saca un «-» inicial y se parte en la coma.
  const t = texto.trim();
  const partes = (t.startsWith("-") ? t.slice(1) : t).split(",");
  const cifras = partes.length === 2 ? cifrasDeUnaPistaDeMiles(partes[0], partes[1].trim()) : null;
  return cifras === null ? null : `Para ${cifras} escribí ${cifras}.`;
}

/** El aviso de la regla del decimal: cuántos admite el contexto. */
function mensajeDeDecimales(contexto: ContextoNumerico, pista: string | null = null): string {
  const base = contexto.decimales === 0 ? "Tiene que ser un número entero." : `Admite como máximo ${contexto.decimales} ${contexto.decimales === 1 ? "decimal" : "decimales"}.`;
  return pista === null ? base : `${base} ${pista}`;
}

/**
 * Lee lo que la PERSONA escribió o pegó en un campo numérico (regla de números del dueño, 2026-11-09): dígitos y UNA coma para los decimales, con un «-» al comienzo si el campo admite negativos. El «.» no se lee: con
 * un punto en cualquier lugar («2.5», «1.234,50», «21.000») es error `punto` con `AVISO_DEL_PUNTO` (ni como decimal ni como miles: sin heurísticas, nunca se adivina). Una coma seguida de más cifras que los
 * decimales del contexto es error de decimales («21,000» en un importe), contadas sobre lo tecleado. Un separador final sin cifras se ignora («5,»); «,5» vale 0,5. Vacío → `null` (campo sin cargar). Notación
 * científica, símbolos, espacios, más de una coma y texto son error de formato; nada se borra en silencio ni se redondea.
 *
 * Errores: `punto`, `formato` (no es un número) y `decimales` (más cifras decimales que las del contexto). Sirve igual en la pantalla (el aviso al teclear lo decide `CampoNumero`) y para el texto que una persona escribió.
 */
export function interpretarNumeroTecleado(texto: string, contexto: ContextoNumerico): ResultadoDato<number | null> {
  const t = String(texto ?? "").trim();
  if (!t) return aceptar(null);
  const negativo = t.startsWith("-");
  const cuerpo = negativo ? t.slice(1) : t;
  if (!RE_SOLO_SEPARADORES_Y_DIGITOS.test(cuerpo) || !/\d/.test(cuerpo)) return rechazar("formato", MENSAJE_NUMERO_INVALIDO);
  if (cuerpo.includes(".")) return rechazar("punto", AVISO_DEL_PUNTO);
  const partes = cuerpo.split(",");
  if (partes.length > 2) return rechazar("formato", MENSAJE_NUMERO_INVALIDO); // dos comas: no hay forma de que sean decimales
  const [entero, decimal = ""] = partes;
  if (decimal.length > contexto.decimales) return rechazar("decimales", mensajeDeDecimales(contexto, pistaDeMiles(cuerpo)));
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
 * El texto que `CampoNumero` emite cuando lo tecleado NO es un número válido: el mismo texto, pero que nunca se pueda leer como canónico. Hace falta porque algo inválido puede PARECER canónico (un valor que llegó por afuera, como «1.205» en un
 * campo de kilos, valdría 1,205 como canónico): sin la marca, un formulario que lee el canal con `Number()` o con `leerNumeroCanonico` lo mandaría como número en silencio.
 */
export function marcarNoCanonico(texto: string): string {
  return RE_CANONICO.test(texto) ? `${texto}${MARCA_DE_NO_CANONICO}` : texto;
}

/** Lo que se ve de un texto del canal: sin la marca (no se ve, pero tampoco tiene que viajar al lector). */
export function sinMarcaDeNoCanonico(texto: string): string {
  return texto.endsWith(MARCA_DE_NO_CANONICO) ? texto.slice(0, -MARCA_DE_NO_CANONICO.length) : texto;
}

/**
 * Un número como se le muestra a quien lo va a EDITAR: el texto canónico con la COMA como decimal y sin separador de miles («1,205», «21000»). Sin punto, así lo que se edita es
 * siempre lo que se puede teclear (el canónico con punto, «1.205», el campo lo rechazaría).
 */
export function textoParaEscribir(n: number): string {
  return textoCanonico(n).replace(".", ",");
}

/**
 * El mensaje de un número tecleado que no se pudo leer, con el sujeto del campo cuando se lo conoce («El precio de venta admite como máximo 2 decimales. Para 100123 escribí 100123.»,
 * «El factor: Los decimales van con coma: 0,5», «La cantidad no es un número válido.»). Sin sujeto, el mensaje del parser tal cual. Lo usan el campo en pantalla y la validación del servidor.
 */
export function mensajeDeNumeroRechazado(rechazo: { codigo: string; mensaje: string }, sujeto?: string): string {
  if (!sujeto) return rechazo.mensaje;
  if (rechazo.codigo === "formato") return `${sujeto} no es un número válido.`;
  if (rechazo.codigo === "punto" || rechazo.codigo === "notacion") return `${sujeto}: ${rechazo.mensaje}`;
  return `${sujeto} ${rechazo.mensaje.charAt(0).toLowerCase()}${rechazo.mensaje.slice(1)}`;
}

/**
 * El rechazo de un número de entrada que no se pudo leer, para los validadores del servidor (y de la pantalla): el código del parser y el mensaje con el sujeto («El precio no es un número válido.», «El factor: Los decimales van
 * con coma: 0,5»). Los errores de DECIMALES llevan el mensaje propio de cada validador (`mensajeDeDecimales`: el de la unidad, el de la columna…) y, si el texto era «21,000», la pista de cómo escribir
 * veintiún mil.
 */
export function rechazoDeNumeroDeEntrada(rechazo: { codigo: string; mensaje: string }, sujeto: string, mensajeDeDecimales: string, valor: unknown): ResultadoDato<never> {
  if (rechazo.codigo === "decimales") {
    const pista = pistaDeMiles(valor);
    return rechazar("decimales", pista === null ? mensajeDeDecimales : `${mensajeDeDecimales} ${pista}`);
  }
  const codigo = rechazo.codigo === "punto" || rechazo.codigo === "notacion" ? rechazo.codigo : "formato";
  return rechazar(codigo, mensajeDeNumeroRechazado(rechazo, sujeto));
}
