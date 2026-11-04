/**
 * N.º de comprobante de una factura de compra, leído de lo que se tecleó (Etapa A, punto 5 del plan unificado). El campo guardado
 * (`Operacion.nroFactura`) sigue siendo TEXTO LIBRE (ver `validarNroFactura`, src/core/datos/nro-factura.ts): esta lectura NO lo cambia ni
 * lo valida, solo decide cómo MOSTRARLO. Función pura (P0): sin reloj, entorno ni Prisma.
 *
 * Lee «1-1234», «0001-00001234» y «A 0001-00001234» (letra A/B/C/E/M, en mayúscula o minúscula, seguida de espacio, guion o nada). Si el punto
 * de venta o el número es 0 o se pasa del rango (punto de venta 1..99999, número 1..99999999), o el texto tiene cualquier otra forma, es LIBRE
 * y se muestra tal cual se guardó. Los dígitos son solo ASCII (0-9).
 *
 * Desde la etapa 1 de Compras (2026-11-03) la carga de una compra exige y arma el texto canónico «A-00023-00237728» con `armarNumeroDeComprobante`
 * y `leerNumeroDeComprobanteDeCompra` (más abajo); el lector de pantalla de arriba no cambia.
 */
import { LARGO_MAXIMO_NRO_FACTURA } from "@/core/texto";
import { aceptar, rechazar, type ResultadoDato } from "./resultado";

const PUNTO_DE_VENTA_MAXIMO = 99999;
const NUMERO_MAXIMO = 99999999;

export const LETRAS_DE_COMPROBANTE = ["A", "B", "C", "E", "M", "X"] as const;
export type LetraDeComprobante = (typeof LETRAS_DE_COMPROBANTE)[number];
const DIGITOS_DEL_PUNTO_DE_VENTA = 5;
const DIGITOS_DEL_NUMERO = 8;


export type NumeroComprobante =
  | { tipo: "NORMALIZADO"; letra: LetraDeComprobante | null; puntoDeVenta: number; numero: number }
  | { tipo: "LIBRE"; texto: string };

const RE_COMPROBANTE = /^\s*(?:([ABCEMabcem])\s*-?\s*)?(\d+)\s*-\s*(\d+)\s*$/;

export function leerNumeroComprobante(texto: string): NumeroComprobante {
  const m = RE_COMPROBANTE.exec(texto);
  if (!m) return { tipo: "LIBRE", texto };
  const puntoDeVenta = Number(m[2]);
  const numero = Number(m[3]);
  if (!(puntoDeVenta >= 1 && puntoDeVenta <= PUNTO_DE_VENTA_MAXIMO)) return { tipo: "LIBRE", texto };
  if (!(numero >= 1 && numero <= NUMERO_MAXIMO)) return { tipo: "LIBRE", texto };
  const letra = m[1] ? (m[1].toUpperCase() as LetraDeComprobante) : null;
  return { tipo: "NORMALIZADO", letra, puntoDeVenta, numero };
}

/** «00001-00001234» (o «A 00001-00001234» con letra). Lo LIBRE vuelve IDÉNTICO al original: ni recortado ni con otras mayúsculas. */
export function formatearNumeroComprobante(comprobante: NumeroComprobante): string {
  if (comprobante.tipo === "LIBRE") return comprobante.texto;
  const cuerpo = `${String(comprobante.puntoDeVenta).padStart(5, "0")}-${String(comprobante.numero).padStart(8, "0")}`;
  return comprobante.letra ? `${comprobante.letra} ${cuerpo}` : cuerpo;
}

const MENSAJE_LETRA = "Elegí la letra de la factura (A, B, C, E, M o X).";
const MENSAJE_FORMATO = "El número de la factura tiene que tener letra, punto de venta y número (por ejemplo A-00023-00237728).";

/** Valida un grupo numérico (punto de venta o número): solo dígitos, hasta `digitos` tal cual se tecleó, no todo ceros. */
function armarGrupo(crudo: string, digitos: number, etiqueta: string, ejemplo: string): ResultadoDato<string> {
  const g = crudo.trim();
  if (!/^\d+$/.test(g) || g.length > digitos) return rechazar("caracteres", `${etiqueta} va solo con números, hasta ${digitos} dígitos (por ejemplo ${ejemplo}).`);
  if (/^0+$/.test(g)) return rechazar("cero", `${etiqueta} no puede ser 0.`);
  return aceptar(g.padStart(digitos, "0"));
}

/**
 * Arma el texto canónico de una factura de proveedor: «A-00023-00237728» (letra, punto de venta de 5 dígitos, número de 8; se completan con ceros a la izquierda).
 * Los códigos de rechazo reusan los de `CodigoDato`: letra → «formato», no-dígitos o demasiados dígitos → «caracteres», todo ceros → «cero».
 */
export function armarNumeroDeComprobante(partes: { letra: string; puntoDeVenta: string; numero: string }): ResultadoDato<string> {
  const letra = partes.letra.trim().toUpperCase();
  if (!(LETRAS_DE_COMPROBANTE as readonly string[]).includes(letra)) return rechazar("formato", MENSAJE_LETRA);
  const pv = armarGrupo(partes.puntoDeVenta, DIGITOS_DEL_PUNTO_DE_VENTA, "El punto de venta", "00023");
  if (!pv.ok) return pv;
  const nro = armarGrupo(partes.numero, DIGITOS_DEL_NUMERO, "El número de la factura", "00237728");
  if (!nro.ok) return nro;
  return aceptar(`${letra}-${pv.valor}-${nro.valor}`);
}

/**
 * Lee el formato con que la pantalla manda el número dentro de `nroFactura`: letra, punto de venta y número separados por guion o espacios («A-23-237728», «a 00023 00237728»)
 * y delega en `armarNumeroDeComprobante`. Vacío → «vacio»; sin esa forma → «formato».
 */
export function leerNumeroDeComprobanteDeCompra(texto: string): ResultadoDato<string> {
  // Un valor que no es texto (payload armado a mano) es «formato», no un error del servidor. El tope de largo va ANTES de la expresión regular: sin él, un texto
  // largo de espacios la hace trabajar de más (el campo guardado nunca pasa de LARGO_MAXIMO_NRO_FACTURA). Separadores sin ambigüedad: «-» con espacios opcionales, o espacios.
  if (typeof texto !== "string") return rechazar("formato", MENSAJE_FORMATO);
  if (!texto.trim()) return rechazar("vacio", "Falta el número de la factura: letra, punto de venta y número.");
  if (texto.length > LARGO_MAXIMO_NRO_FACTURA) return rechazar("formato", MENSAJE_FORMATO);
  const m = /^\s*([A-Za-z])(?:\s*-\s*|\s+)(\d+)(?:\s*-\s*|\s+)(\d+)\s*$/.exec(texto);
  if (!m) return rechazar("formato", MENSAJE_FORMATO);
  return armarNumeroDeComprobante({ letra: m[1], puntoDeVenta: m[2], numero: m[3] });
}

/** Lo que la pantalla de una compra teclea en TRES campos (letra, punto de venta y número); `armarNumeroDeComprobante` los junta. Todo texto: los vacíos son «todavía no tecleado». */
export interface PartesDeNumeroDeComprobante {
  letra: string;
  puntoDeVenta: string;
  numero: string;
}

export const PARTES_DE_NUMERO_VACIAS: PartesDeNumeroDeComprobante = { letra: "", puntoDeVenta: "", numero: "" };

/** Deja solo los dígitos ASCII (0-9) de lo tecleado o pegado en el punto de venta o el número, cortado a `maximo`. */
export function soloDigitos(texto: string, maximo: number): string {
  return texto.replace(/[^0-9]/g, "").slice(0, maximo);
}

export const MAXIMO_DE_DIGITOS_DEL_PUNTO_DE_VENTA = DIGITOS_DEL_PUNTO_DE_VENTA;
export const MAXIMO_DE_DIGITOS_DEL_NUMERO = DIGITOS_DEL_NUMERO;

/**
 * Qué muestra la pantalla debajo de los tres campos: `vacio` (no se tecleó nada: sin error todavía), `valido` con el texto armado y con ceros («A-00023-00237728») o `error` con qué falta o está mal.
 * Los mensajes de caracteres y de ceros son los de `armarNumeroDeComprobante`; lo que falta se avisa aparte, campo por campo.
 */
export type EstadoDelNumeroTecleado = { tipo: "vacio" } | { tipo: "valido"; numero: string } | { tipo: "error"; mensaje: string };

export function estadoDelNumeroTecleado(partes: PartesDeNumeroDeComprobante): EstadoDelNumeroTecleado {
  const letra = partes.letra.trim();
  const pv = partes.puntoDeVenta.trim();
  const nro = partes.numero.trim();
  if (!letra && !pv && !nro) return { tipo: "vacio" };
  if (!letra) return { tipo: "error", mensaje: MENSAJE_LETRA };
  if (!pv) return { tipo: "error", mensaje: "Falta el punto de venta (hasta 5 dígitos, por ejemplo 00023)." };
  if (!nro) return { tipo: "error", mensaje: "Falta el número de la factura (hasta 8 dígitos, por ejemplo 00237728)." };
  const armado = armarNumeroDeComprobante(partes);
  return armado.ok ? { tipo: "valido", numero: armado.valor } : { tipo: "error", mensaje: armado.mensaje };
}

/** Las tres partes de un número YA guardado, si tiene la forma «A-00023-00237728» (o la que lee `leerNumeroDeComprobanteDeCompra`); `null` si está vacío o es un texto libre de una compra vieja. */
export function partesDeNumeroGuardado(texto: string | null | undefined): PartesDeNumeroDeComprobante | null {
  const leido = leerNumeroDeComprobanteDeCompra(texto ?? "");
  if (!leido.ok) return null;
  const [letra, puntoDeVenta, numero] = leido.valor.split("-");
  return { letra, puntoDeVenta, numero };
}
