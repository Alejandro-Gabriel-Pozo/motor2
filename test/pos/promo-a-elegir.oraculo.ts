/**
 * ORÁCULO de la promo «a elegir» (etapa N1, PR A; docs/diseno-promo-subconjunto-2026-11-04.md §10 y regla «Combinaciones» de AGENTS.md). Las reglas esperadas están escritas ACÁ, en una tabla legible y aparte del
 * código: `promo-a-elegir-oraculo.test.ts` recorre TODO el producto cartesiano de las dimensiones contra el código real (exhaustivo: 2×3×6×2×2×2 = 288 combinaciones) y compara con esta tabla. No se genera del código.
 *
 * El caso: un BIFE «se vende por opción» con tres grupos, y una entrada «a elegir» que PERMITE solo Criolla, Puré y Ensalada (con tope de 1 unidad de Ensalada):
 *   Preparación (MEDIDA, obligatoria, 1 a 1):  Criolla [permitida] · Chimichurri [del producto, NO permitida]
 *   Guarnición  (VARIANTE, obligatoria, 1 a 2): Puré [permitida, tope 2] · Ensalada [permitida, tope 1] · Papas [del producto, NO permitida]
 *   Extras      (ADICIONAL, opcional, 0 a 3):  Huevo [nunca: una promo de precio fijo no lleva adicionales]
 *
 * DIMENSIONES (las que cambian si lo elegido se acepta):
 *   O  modo de la entrada      A_ELEGIR · FIJAS            (FIJAS = la entrada de siempre: no deja elegir opciones)
 *   X  lo elegido de Preparación   CRIOLLA · CHIMICHURRI · NADA
 *   Q  lo elegido de Guarnición    NADA · PURE · PURE_Y_ENSALADA · ENSALADA_X2 · PURE_X2_Y_ENSALADA · PAPAS
 *   E  adicional                   SIN_EXTRA · CON_HUEVO
 *   G  Puré en la sucursal         ACTIVO · APAGADO
 *   V  versión que vio el mozo     VIGENTE · VIEJA
 *
 * REGLAS (el PRIMER problema gana, en este orden; es el de `validarOpcionesElegidas`, que el servidor reutiliza):
 *   R0  FIJAS con opciones mandadas            → RECHAZA  (sin código: «no se eligen opciones»)
 *   R1  algo elegido fuera de lo permitido efectivo (Chimichurri, Papas, Huevo, o Puré apagado) → OPCION_NO_PERMITIDA_EN_PROMO
 *   R2  versión vieja                          → OPCION_CAMBIO
 *   R3  más unidades de una opción que el tope de la entrada (Ensalada ×2; tope 1) → OPCIONES_INVALIDAS
 *   R4  más unidades en un grupo que su máximo (Guarnición: 3 unidades, máximo 2)  → OPCIONES_INVALIDAS
 *   R5  falta lo obligatorio (Preparación o Guarnición sin elegir)                → OPCIONES_INVALIDAS
 *   R6  lo demás                               → ACEPTA, y el total cobrado es SIEMPRE el precio de la promo (I4)
 */

export const MODOS = ["A_ELEGIR", "FIJAS"] as const;
export const PREPARACIONES = ["CRIOLLA", "CHIMICHURRI", "NADA"] as const;
export const GUARNICIONES = ["NADA", "PURE", "PURE_Y_ENSALADA", "ENSALADA_X2", "PURE_X2_Y_ENSALADA", "PAPAS"] as const;
export const EXTRAS = ["SIN_EXTRA", "CON_HUEVO"] as const;
export const ESTADOS_DEL_PURE = ["ACTIVO", "APAGADO"] as const;
export const VERSIONES = ["VIGENTE", "VIEJA"] as const;

export interface Combinacion {
  modo: (typeof MODOS)[number];
  preparacion: (typeof PREPARACIONES)[number];
  guarnicion: (typeof GUARNICIONES)[number];
  extra: (typeof EXTRAS)[number];
  pure: (typeof ESTADOS_DEL_PURE)[number];
  version: (typeof VERSIONES)[number];
}

export type Esperado = { acepta: true } | { acepta: false; codigo: "OPCION_NO_PERMITIDA_EN_PROMO" | "OPCION_CAMBIO" | "OPCIONES_INVALIDAS" | "FIJA_RECHAZA_OPCIONES" };

export function todasLasCombinaciones(): Combinacion[] {
  const salida: Combinacion[] = [];
  for (const modo of MODOS) for (const preparacion of PREPARACIONES) for (const guarnicion of GUARNICIONES) for (const extra of EXTRAS) for (const pure of ESTADOS_DEL_PURE) for (const version of VERSIONES) {
    salida.push({ modo, preparacion, guarnicion, extra, pure, version });
  }
  return salida;
}

/** ¿Se mandó alguna opción? (con FIJAS y nada elegido, la elección no trae `opciones`: es la entrada de siempre.) */
export function seMandoAlgunaOpcion(c: Combinacion): boolean {
  return c.preparacion !== "NADA" || c.guarnicion !== "NADA" || c.extra === "CON_HUEVO";
}

/** La tabla de reglas, tal cual está escrita arriba. */
export function esperado(c: Combinacion): Esperado {
  // R0
  if (c.modo === "FIJAS") return seMandoAlgunaOpcion(c) ? { acepta: false, codigo: "FIJA_RECHAZA_OPCIONES" } : { acepta: true };
  // R1
  const fueraDeLoPermitido = c.preparacion === "CHIMICHURRI" || c.guarnicion === "PAPAS" || c.extra === "CON_HUEVO" || (c.pure === "APAGADO" && (c.guarnicion === "PURE" || c.guarnicion === "PURE_Y_ENSALADA" || c.guarnicion === "PURE_X2_Y_ENSALADA"));
  if (fueraDeLoPermitido) return { acepta: false, codigo: "OPCION_NO_PERMITIDA_EN_PROMO" };
  // R2
  if (c.version === "VIEJA" && seMandoAlgunaOpcion(c)) return { acepta: false, codigo: "OPCION_CAMBIO" };
  // R3
  if (c.guarnicion === "ENSALADA_X2") return { acepta: false, codigo: "OPCIONES_INVALIDAS" };
  // R4
  if (c.guarnicion === "PURE_X2_Y_ENSALADA") return { acepta: false, codigo: "OPCIONES_INVALIDAS" };
  // R5
  if (c.preparacion === "NADA" || c.guarnicion === "NADA") return { acepta: false, codigo: "OPCIONES_INVALIDAS" };
  // R6
  return { acepta: true };
}
