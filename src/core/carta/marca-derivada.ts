import { rgbDeColorCss } from "./color-css";

/**
 * La marca de la carta (paso 9 de la auditoría, `docs/diseno-marca-por-sucursal-y-empresa-2026-11-12.md`): UN color por sucursal y UNO por empresa; todo lo demás se DERIVA.
 * Este archivo es el núcleo PURO (sin Prisma, sin React): lee un color guardado, decide si se lee, calcula los contrastes (WCAG 2.1) y deriva la tinta del texto sobre la marca, el tono de
 * «pasar el mouse» y el tinte de fondo suave. Lo usan el guardado (rechaza lo que no se lee, M2 y M3), la lectura de la carta pública y el editor (el aviso de contraste).
 *
 * Reglas del diseño que cumple:
 *  - M1: al GUARDAR, la marca es `#rrggbb` en minúsculas (`esMarcaHex`: lista de permitidos). Al LEER un valor ya guardado se acepta lo que se pueda convertir (`marcaGuardadaLegible`: hex corto,
 *    rgb, hsl u oklch; decisión del dueño 2026-11-13 «Se usa si se puede leer (Recomendada)»); un nombre CSS o texto que no se puede leer da null (y la carta usa el color del sistema).
 *  - M2: el texto derivado sobre la marca tiene contraste >= 4,5:1; si ninguna de las dos tintas fijas llega, se rechaza al guardar (decisión del dueño 2026-11-13 «Se rechaza y dice qué hacer (Recomendada)»).
 *  - M3: la marca contra el fondo de la carta tiene contraste >= 3:1 (color de elemento).
 *
 * El contraste se compara SIN redondear (4,499 no es 4,5). La tinta es la más legible de las dos fijas (las mismas que usa `resolvePrimaryForeground`).
 */

export type Canales = readonly [number, number, number];

/** M2: contraste mínimo del texto derivado sobre la marca (WCAG AA, texto normal). */
const CONTRASTE_MINIMO_TEXTO = 4.5;
/** M3: contraste mínimo de la marca contra el fondo (WCAG 1.4.11, elementos de interfaz). */
const CONTRASTE_MINIMO_ELEMENTO = 3;

/** Las dos tintas fijas: las mismas literales que `inkFromLuminance` de `color-css.ts` (una prueba fija la paridad). */
export const TINTA_CLARA = "oklch(0.96 0.005 80)";
export const TINTA_OSCURA = "oklch(0.18 0.02 40)";

const LARGO_MAXIMO_DEL_VALOR = 64;
const MARCA_HEX = /^#[0-9a-f]{6}$/;

function canalesDeLaTinta(css: string): Canales {
  const canales = rgbDeColorCss(css);
  if (!canales) throw new Error(`marca-derivada: no se pudo leer la tinta fija ${css}`);
  return canales;
}

const CANALES_TINTA_CLARA = canalesDeLaTinta(TINTA_CLARA);
const CANALES_TINTA_OSCURA = canalesDeLaTinta(TINTA_OSCURA);

const NEGRO: Canales = [0, 0, 0];
const BLANCO: Canales = [255, 255, 255];

const acotar = (n: number) => Math.min(255, Math.max(0, Math.round(n)));

/** M1 al guardar: `#rrggbb` en minúsculas y nada más (sin funciones, sin nombres CSS, sin `#rgb`, sin transparencia). */
export function esMarcaHex(valor: unknown): valor is string {
  return typeof valor === "string" && MARCA_HEX.test(valor);
}

/** `#rrggbb` en minúsculas a partir de los canales (se acotan a 0–255 y se redondean). */
export function aHex(canales: Canales): string {
  return `#${canales.map((c) => acotar(c).toString(16).padStart(2, "0")).join("")}`;
}

/** Los canales de un `#rrggbb` ya validado (`esMarcaHex`); null si no lo es. */
export function canalesDeMarcaHex(valor: string): Canales | null {
  if (!esMarcaHex(valor)) return null;
  return [parseInt(valor.slice(1, 3), 16), parseInt(valor.slice(3, 5), 16), parseInt(valor.slice(5, 7), 16)];
}

/**
 * Lectura de una marca YA guardada (puede ser de antes de M1): devuelve `#rrggbb` si el valor se puede leer (hex de 3 o 6 dígitos, rgb, rgba, hsl, hsla u oklch; la transparencia se ignora) y null si
 * no (un nombre CSS como `red`, `inherit`, `transparent`, un texto cualquiera, un valor que no es texto o de más de 64 caracteres). Null = la carta usa el color del sistema (falla cerrado).
 */
export function marcaGuardadaLegible(valor: unknown): string | null {
  if (typeof valor !== "string" || valor.length === 0 || valor.length > LARGO_MAXIMO_DEL_VALOR) return null;
  const canales = rgbDeColorCss(valor);
  if (!canales || !canales.every((c) => Number.isFinite(c))) return null;
  return aHex(canales);
}

function linealizar(canal: number): number {
  const c = acotar(canal) / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Luminancia relativa WCAG 2.1. */
function luminanciaRelativa(canales: Canales): number {
  return 0.2126 * linealizar(canales[0]) + 0.7152 * linealizar(canales[1]) + 0.0722 * linealizar(canales[2]);
}

/** Razón de contraste WCAG 2.1 entre dos colores: de 1 (iguales) a 21 (negro sobre blanco). Simétrica. */
export function contraste(a: Canales, b: Canales): number {
  const la = luminanciaRelativa(a);
  const lb = luminanciaRelativa(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface TintaSobreMarca {
  tinta: "clara" | "oscura";
  /** El color CSS de la tinta (una de las dos fijas). */
  css: string;
  /** Contraste de esa tinta sobre la marca. */
  contraste: number;
}

/** La más legible de las dos tintas fijas sobre esa marca (si empatan, la oscura). */
export function tintaSobreMarca(marca: Canales): TintaSobreMarca {
  const clara = contraste(marca, CANALES_TINTA_CLARA);
  const oscura = contraste(marca, CANALES_TINTA_OSCURA);
  return clara > oscura ? { tinta: "clara", css: TINTA_CLARA, contraste: clara } : { tinta: "oscura", css: TINTA_OSCURA, contraste: oscura };
}

export type ProblemaDeMarca = "TEXTO_SOBRE_MARCA" | "MARCA_SOBRE_FONDO";

export interface EvaluacionDeMarca {
  marca: string;
  tinta: TintaSobreMarca;
  contrasteMarcaFondo: number;
  problemas: ProblemaDeMarca[];
  ok: boolean;
}

/** M2 y M3 de una marca contra el fondo de la carta. `ok` solo si no hay ningún problema. */
export function evaluarMarca(marca: Canales, fondo: Canales): EvaluacionDeMarca {
  const tinta = tintaSobreMarca(marca);
  const contrasteMarcaFondo = contraste(marca, fondo);
  const problemas: ProblemaDeMarca[] = [];
  if (tinta.contraste < CONTRASTE_MINIMO_TEXTO) problemas.push("TEXTO_SOBRE_MARCA");
  if (contrasteMarcaFondo < CONTRASTE_MINIMO_ELEMENTO) problemas.push("MARCA_SOBRE_FONDO");
  return { marca: aHex(marca), tinta, contrasteMarcaFondo, problemas, ok: problemas.length === 0 };
}

/** «4,09» y no «4,1»: se trunca (nunca se muestra un número que redondea hacia arriba hasta el mínimo que no se alcanzó). */
// El 1e-9 compensa el error de coma flotante (2,07 * 100 da 206,99999…) sin cambiar el sentido: nunca sube un número hasta un mínimo que no se alcanzó.
const texto = (n: number) => (Math.floor(n * 100 + 1e-9) / 100).toFixed(2).replace(".", ",");

/** Qué decirle a quien eligió el color cuando se rechaza: el problema y qué hacer. Vacío si no hay problemas. */
export function mensajeDeMarca(evaluacion: EvaluacionDeMarca): string {
  const partes: string[] = [];
  if (evaluacion.problemas.includes("TEXTO_SOBRE_MARCA")) {
    partes.push(`El texto sobre este color no se lee bien (contraste ${texto(evaluacion.tinta.contraste)}:1; hace falta ${texto(CONTRASTE_MINIMO_TEXTO)}:1). Elegí uno más claro o más oscuro.`);
  }
  if (evaluacion.problemas.includes("MARCA_SOBRE_FONDO")) {
    partes.push(`Este color casi no se distingue del fondo de la carta (contraste ${texto(evaluacion.contrasteMarcaFondo)}:1; hace falta ${texto(CONTRASTE_MINIMO_ELEMENTO)}:1). Elegí uno más fuerte.`);
  }
  return partes.join(" ");
}

/** Mezcla `parte` (0 a 1) de `b` en `a`, canal por canal. */
function mezclar(a: Canales, b: Canales, parte: number): Canales {
  return [a[0] + (b[0] - a[0]) * parte, a[1] + (b[1] - a[1]) * parte, a[2] + (b[2] - a[2]) * parte];
}

export interface DerivadosDeMarca {
  marca: string;
  /** Color del texto sobre la marca (una de las dos tintas fijas). */
  tinta: string;
  /** Tono de «pasar el mouse»: la marca movida 12 % hacia el negro (si el texto es claro) o hacia el blanco (si es oscuro), así el texto gana contraste y nunca lo pierde. */
  hover: string;
  /** Tinte de fondo suave: el fondo de la carta con 8 % de marca. */
  tinte: string;
}

/** Lo que el sistema calcula a partir de la marca (no se guarda): se arma cada vez que se lee. */
export function derivarDeMarca(marca: Canales, fondo: Canales): DerivadosDeMarca {
  const tinta = tintaSobreMarca(marca);
  const haciaDondeSeAleja: Canales = tinta.tinta === "clara" ? NEGRO : BLANCO;
  return { marca: aHex(marca), tinta: tinta.css, hover: aHex(mezclar(marca, haciaDondeSeAleja, 0.12)), tinte: aHex(mezclar(fondo, marca, 0.08)) };
}
