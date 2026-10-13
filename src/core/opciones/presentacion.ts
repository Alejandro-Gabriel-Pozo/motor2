import { Decimal } from "decimal.js";
import { porcentajeDeImporte } from "@/core/moneda";
import type { DiferenciaDePrecio, TipoDeGrupoDeOpciones } from "./tipos";

/**
 * Los TEXTOS de las pantallas de opciones de venta (GO-2d; ADR-030, «Pantallas»): cómo se nombra cada tipo de grupo, cómo se leen sus límites y cómo se explica una diferencia
 * de precio. Funciones PURAS y sin formato de moneda (eso es de quien muestra: `formatearMonto`), así la administración, el selector del POS y la carta pública dicen lo mismo
 * con las mismas palabras. En español rioplatense, sin jerga: el usuario nunca lee «MEDIDA», «VARIANTE» ni «versión».
 *
 * Qué NO decide: ningún precio que se cobra. El «espejo» de un porcentaje (cuánto da en pesos sobre un precio de referencia) es una REFERENCIA para quien carga la opción:
 * lo calcula la misma cuenta exacta del núcleo (`porcentajeDeImporte`, un solo redondeo al centavo), pero el precio de cada venta lo compone el servidor al vender.
 */

/** Cómo se llama cada tipo de grupo en pantalla. */
export function nombreDelTipoDeGrupo(tipo: TipoDeGrupoDeOpciones): string {
  switch (tipo) {
    case "MEDIDA":
      return "Tamaño";
    case "VARIANTE":
      return "Variante";
    case "INCLUIDA":
      return "Incluida sin costo";
    case "ADICIONAL":
      return "Adicional con recargo";
  }
}

/** La ayuda de una línea de cada tipo (el alta de un grupo la muestra al lado del tipo elegido). */
export function ayudaDelTipoDeGrupo(tipo: TipoDeGrupoDeOpciones): string {
  switch (tipo) {
    case "MEDIDA":
      return "Chico, mediano, grande (o 30, 60, 90 minutos): se elige siempre uno y cambia el precio y lo que se consume.";
    case "VARIANTE":
      return "Con leche, cortado, sin sal: cambia la preparación y puede sumar o restar al precio.";
    case "INCLUIDA":
      return "La guarnición o el acompañamiento que ya viene en el precio: se elige sin costo.";
    case "ADICIONAL":
      return "Huevo frito, extra queso: se cobra aparte y va en su propia línea del ticket.";
  }
}

/** Los límites de un grupo en palabras: «Elegí 1», «Opcional · hasta 2», «Elegí de 1 a 3». */
export function textoDeLimites(cantidadMinima: number, cantidadMaxima: number): string {
  if (cantidadMinima === 0) return `Opcional · hasta ${cantidadMaxima}`;
  if (cantidadMinima === cantidadMaxima) return `Elegí ${cantidadMinima}`;
  return `Elegí de ${cantidadMinima} a ${cantidadMaxima}`;
}

/** Si el grupo obliga a elegir algo (su mínimo, el del producto si lo sobrescribe, es 1 o más). */
export function esGrupoObligatorio(cantidadMinima: number): boolean {
  return cantidadMinima > 0;
}

/**
 * Una diferencia de precio en palabras, con el formato de moneda que le pasa quien muestra: «+ $ 400», «− $ 200», «+ 16 %», «sin recargo». El porcentaje se escribe con coma
 * decimal (es-AR) y sin ceros de más.
 */
export function textoDeDiferencia(diferencia: DiferenciaDePrecio | null, formatear: (monto: number) => string): string {
  if (diferencia === null) return "sin recargo";
  if (diferencia.tipo === "MONTO") {
    if (diferencia.monto === 0) return "sin recargo";
    return `${diferencia.monto > 0 ? "+" : "−"} ${formatear(Math.abs(diferencia.monto))}`;
  }
  if (diferencia.porcentaje === 0) return "sin recargo";
  return `${diferencia.porcentaje > 0 ? "+" : "−"} ${textoDePorcentaje(Math.abs(diferencia.porcentaje))} %`;
}

/** Un porcentaje con coma decimal y hasta 4 decimales, sin ceros a la derecha: 16 → «16», 12,5 → «12,5». */
export function textoDePorcentaje(porcentaje: number): string {
  return porcentaje.toLocaleString("es-AR", { maximumFractionDigits: 4, useGrouping: false });
}

/**
 * El ESPEJO de una diferencia sobre un precio de referencia (el precio base del producto en una sucursal), para mostrarlo al lado del campo como «referencia»:
 * - un MONTO se lee también como porcentaje del precio (en decimal exacto, redondeado a 1 decimal: es solo una referencia visual);
 * - un PORCENTAJE se lee también como el monto que daría, con la MISMA cuenta exacta que usa la venta (`porcentajeDeImporte`, un redondeo al centavo).
 * Con un precio de referencia de 0 o menos no hay espejo (`null`): no hay sobre qué calcular.
 */
export function espejoDeDiferencia(
  diferencia: DiferenciaDePrecio,
  precioDeReferencia: number
): { tipo: "PORCENTAJE"; porcentaje: number } | { tipo: "MONTO"; monto: number } | null {
  if (!Number.isFinite(precioDeReferencia) || precioDeReferencia <= 0) return null;
  if (diferencia.tipo === "PORCENTAJE") return { tipo: "MONTO", monto: porcentajeDeImporte(precioDeReferencia, diferencia.porcentaje) };
  return { tipo: "PORCENTAJE", porcentaje: new Decimal(diferencia.monto).times(100).dividedBy(precioDeReferencia).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toNumber() };
}
