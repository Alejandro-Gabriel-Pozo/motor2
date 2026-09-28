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
 *  - El mismo separador repetido es de MILES y tiene que agrupar bien: el primer grupo de 1 a 3 dígitos y los siguientes de 3
 *    ("1.000.000" = 1000000; "1,2,3" y "1.2.3" son error).
 *  - Con los dos separadores, el último es el decimal (una sola vez) y el otro tiene que ser una agrupación de miles válida
 *    ("1.234,56" = "1,234.56" = 1234,56; "1.23,4" es error).
 *  - Acepta ",5" y "5," (tecleo a medias).
 */
const MENSAJE_NUMERO_INVALIDO = "No es un número válido.";

const RE_GRUPO_INICIAL = /^\d{1,3}$/;
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
 * Lo que un formulario le manda a la Server Action a partir del texto de un CampoNumero: vacío → `undefined`, válido → el número,
 * inválido → `NaN`. Nunca 0 por un texto que no es número (lo que hacía `Number("")`), así el servidor lo rechaza.
 */
export function numeroDelCampo(texto: string): number | undefined {
  const r = interpretarNumero(texto);
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
