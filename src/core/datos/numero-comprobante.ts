/**
 * N.º de comprobante de una factura de compra, leído de lo que se tecleó (Etapa A, punto 5 del plan unificado). El campo guardado
 * (`Operacion.nroFactura`) sigue siendo TEXTO LIBRE (ver `validarNroFactura`, src/core/datos/nro-factura.ts): esta lectura NO lo cambia ni
 * lo valida, solo decide cómo MOSTRARLO. Función pura (P0): sin reloj, entorno ni Prisma.
 *
 * Lee «1-1234», «0001-00001234» y «A 0001-00001234» (letra A/B/C/E/M, en mayúscula o minúscula, seguida de espacio, guion o nada). Si el punto
 * de venta o el número es 0 o se pasa del rango (punto de venta 1..99999, número 1..99999999), o el texto tiene cualquier otra forma, es LIBRE
 * y se muestra tal cual se guardó. Los dígitos son solo ASCII (0-9).
 */

const PUNTO_DE_VENTA_MAXIMO = 99999;
const NUMERO_MAXIMO = 99999999;

type LetraDeComprobante = "A" | "B" | "C" | "E" | "M";

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
