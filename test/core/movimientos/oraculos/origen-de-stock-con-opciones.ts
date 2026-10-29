/**
 * ORÁCULO del origen de stock de una línea con opciones (diseño «ventas con opciones», 2026-10-29, sección E). Vive APARTE del código bajo prueba y está escrito a mano como una TABLA:
 * ninguna cuenta sale de `rechazoSinOrigenDeStock` ni de `consumoDeLineaConfigurada`. Cada fila dice, para una base y un consumo de opción, si la línea se vende y qué insumos descuenta.
 *
 * Dimensiones: B base (con X / vacía) · P `seProduce` (no / sí) · L tipo de línea (sin configurar / PRODUCTO / ADICIONAL) · G grupo de la opción (MEDIDA / VARIANTE / INCLUIDA) ·
 * C consumo de la opción (ninguno / «ninguna» / SUMA Y / REEMPLAZA X→Y / REEMPLAZA Z→Y con Z fuera de la base / SUMA Y + REEMPLAZA X→W).
 */

export type Base = "con X" | "vacía";
export type TipoDeGrupo = "MEDIDA" | "VARIANTE" | "INCLUIDA";
export type ConsumoDeLaOpcion = "ninguno" | "«ninguna»" | "SUMA Y" | "REEMPLAZA X→Y" | "REEMPLAZA Z→Y" | "SUMA Y + REEMPLAZA X→W";

export const BASES: readonly Base[] = ["con X", "vacía"];
export const GRUPOS: readonly TipoDeGrupo[] = ["MEDIDA", "VARIANTE", "INCLUIDA"];
export const CONSUMOS: readonly ConsumoDeLaOpcion[] = ["ninguno", "«ninguna»", "SUMA Y", "REEMPLAZA X→Y", "REEMPLAZA Z→Y", "SUMA Y + REEMPLAZA X→W"];

export interface Esperado {
  /** `true` = la línea se vende. */
  acepta: boolean;
  /** Los insumos que descuenta, ordenados (vacío si no descuenta nada o si se rechaza). */
  descuenta: readonly string[];
  /** Por qué se rechaza, si se rechaza: `"sin insumos"` (la regla del origen de stock) o `"se produce por lote"` (la línea con opciones de un PV que se produce). */
  motivo?: "sin insumos" | "se produce por lote";
}

/** PRODUCTO con base de un ingrediente X: se vende siempre. */
const CON_BASE: Readonly<Record<ConsumoDeLaOpcion, readonly string[]>> = {
  ninguno: ["X"],
  "«ninguna»": ["X"],
  "SUMA Y": ["X", "Y"],
  "REEMPLAZA X→Y": ["Y"],
  "REEMPLAZA Z→Y": ["X"], // Z no está en la base: el reemplazo no tiene efecto
  "SUMA Y + REEMPLAZA X→W": ["W", "Y"],
};

/** PRODUCTO con base vacía: solo producen consumo las SUMA; un REEMPLAZA no tiene qué reemplazar. */
const SIN_BASE: Readonly<Record<ConsumoDeLaOpcion, readonly string[]>> = {
  ninguno: [],
  "«ninguna»": [],
  "SUMA Y": ["Y"],
  "REEMPLAZA X→Y": [],
  "REEMPLAZA Z→Y": [],
  "SUMA Y + REEMPLAZA X→W": ["Y"],
};

export function esperadoSinConfigurar(base: Base, seProduce: boolean): Esperado {
  return seProduce || base === "con X" ? { acepta: true, descuenta: [] } : { acepta: false, descuenta: [], motivo: "sin insumos" };
}

export function esperadoDeProducto(base: Base, seProduce: boolean, consumo: ConsumoDeLaOpcion): Esperado {
  if (seProduce) return { acepta: false, descuenta: [], motivo: "se produce por lote" };
  const descuenta = (base === "con X" ? CON_BASE : SIN_BASE)[consumo];
  if (base === "con X") return { acepta: true, descuenta };
  return descuenta.length > 0 ? { acepta: true, descuenta } : { acepta: false, descuenta: [], motivo: "sin insumos" };
}

/** ADICIONAL: acepta siempre (excepción vigente, el dueño 2026-10-29: se deja como hoy); con SUMA descuenta Y, sin consumo no descuenta nada. */
export function esperadoDeAdicional(consumo: "SUMA Y" | "ninguno"): Esperado {
  return { acepta: true, descuenta: consumo === "SUMA Y" ? ["Y"] : [] };
}
