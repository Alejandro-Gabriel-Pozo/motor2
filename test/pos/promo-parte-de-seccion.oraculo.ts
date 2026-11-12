/**
 * ORÁCULO de combinaciones de una PARTE de promo (diseño docs/diseno-promo-parte-de-seccion-2026-11-11.md §5, etapa E1a) y regla «Combinaciones» de AGENTS.md. Las reglas esperadas están escritas ACÁ y en
 * docs/oraculo-combinaciones-promo-parte-de-seccion-2026-11-11.md, en una tabla legible y aparte del código: `promo-parte-de-seccion-oraculo.test.ts` recorre TODO el producto cartesiano de las dimensiones
 * contra el código real y compara con `esperado`. La tabla no se genera del código. Es el hermano de `promo-a-elegir.oraculo.ts` (que recorre las opciones PERMITIDAS de una entrada «a elegir»; acá se recorre
 * qué entra en una parte y qué se le acepta al mozo).
 *
 * El caso: una parte con cupo de 3 a 4 unidades y UN plato «bajo prueba» (`plato`) más un plato siempre válido (`otro`, sin opciones, $ 1.500). Platos posibles (K):
 *   SIN_GRUPOS             sin grupos de opciones ($ 18.000)
 *   SOLO_OPCIONALES        Salsa (VARIANTE, 0 a 1: Ketchup, Mayo +$ 500) y Extras (ADICIONAL, 0 a 3: Huevo)
 *   CON_OBLIGATORIO        Taza (MEDIDA en diferencia, 1 a 1: Chica, Grande +$ 2.000) y Extras (ADICIONAL opcional) — guardado $ 18.000
 *   ADICIONAL_OBLIGATORIO  Salsa y Extras con el adicional OBLIGATORIO (1 a 3)
 *   BASE_POR_OPCION        Tamaño (MEDIDA en ABSOLUTO, 1 a 1: Chica $ 9.000, Grande $ 15.000) y Extras — «se vende por opción»: el precio guardado ($ 9.000) no se cobra
 *
 * DIMENSIONES (las que cambian si lo elegido se acepta o el peso del reparto):
 *   M  modo de la parte        TODA_LA_SECCION · SOLO_ESTOS_FIJAS · SOLO_ESTOS_A_ELEGIR   (M y F del diseño juntos: F solo existe con «Solo estos platos»; «Toda la sección» no tiene F)
 *   K  tipo de plato           SIN_GRUPOS · SOLO_OPCIONALES · CON_OBLIGATORIO · ADICIONAL_OBLIGATORIO · BASE_POR_OPCION
 *   X  lo elegido              DENTRO (una opción del plato) · SIN_ELEGIR (el plato sin opciones) · OPCION_FUERA (el adicional Huevo, que nunca se ofrece) · PLATO_FUERA (un plato que no es de la parte)
 *   G  la opción elegida en la sucursal   ACTIVA · APAGADA   (la que elige DENTRO: Mayo, o Grande)
 *   P  el plato en la sucursal DISPONIBLE · APAGADO · SIN_ORIGEN_DE_STOCK
 *   Q  total de la parte       BAJO_MIN (2) · EN_RANGO (3) · SOBRE_MAX (5)
 *   R  repetición              DISTINTOS (el plato y 1 unidad de otro plato) · MISMO_PLATO_X2 (todas las unidades del mismo plato, en una fila: el 2x1 que el dueño confirmó el 2026-11-11)
 *   V  versión de la opción    VIGENTE · VIEJA
 * «SIN_ELEGIR» NO está en el §5.1 del diseño: se agregó porque la regla 6 («sin el mínimo del grupo») necesita una elección sin opciones; sin ese valor no se podría probar.
 * Declaradas SIN efecto (no son dimensión): la sucursal (la promo ya viene filtrada), quién es el mozo, el medio de pago, el precio local (cambia el importe, no lo que se acepta).
 * IMPOSIBLES (se declaran, no se prueban): X = OPCION_FUERA con K = SIN_GRUPOS (no hay nada de lo que salirse) y G = APAGADA con K = SIN_GRUPOS (no hay opción que apagar).
 *
 * REGLAS (el PRIMER problema gana, en el orden en que las evalúa el servidor: la lectura de la sucursal, después la elección entera con sus cupos, después cada plato; el §5.2 del diseño tenía el mínimo y el
 * máximo de la parte al final: cambia solo QUÉ mensaje se da cuando hay dos problemas a la vez, nunca si se acepta o se rechaza):
 *   R1  el plato no se ofrece: PLATO_FUERA; plato APAGADO; K = ADICIONAL_OBLIGATORIO (un adicional obligatorio rompe el precio fijo); «el mozo elige» con K = SIN_GRUPOS (no hay nada para elegir);
 *       con «Solo estos platos», un plato SIN_ORIGEN_DE_STOCK (la lectura no lo trae)                                                          → NO_SE_OFRECE
 *   R3  «Solo estos platos» con opciones fijas y opciones mandadas                                                                            → FIJAS_CON_OPCIONES
 *   R7  total de la parte por debajo del mínimo / por encima del máximo                                                                       → CUPO_MIN / CUPO_MAX
 *   R4  la opción elegida es OPCION_FUERA (un adicional) o está APAGADA                                                                       → OPCION_NO_PERMITIDA_EN_PROMO
 *   R5  versión vieja de la opción elegida                                                                                                    → OPCION_CAMBIO
 *   R6  K = CON_OBLIGATORIO o BASE_POR_OPCION sin elegir nada                                                                                 → OPCIONES_INVALIDAS
 *   R8  «Toda la sección» con el plato SIN_ORIGEN_DE_STOCK (lo detecta al armar, el último chequeo)                                          → SIN_ORIGEN_DE_STOCK
 *   R9  lo demás → ACEPTA. Con «Toda la sección» o «el mozo elige», el peso del reparto es el precio de lista de la configuración ELEGIDA (I8); con «Solo estos platos» fijas, lo fija la entrada.
 *       El total cobrado es SIEMPRE el precio de la promo (I1).
 */

export const MODOS_DE_PARTE = ["TODA_LA_SECCION", "SOLO_ESTOS_FIJAS", "SOLO_ESTOS_A_ELEGIR"] as const;
export const TIPOS_DE_PLATO = ["SIN_GRUPOS", "SOLO_OPCIONALES", "CON_OBLIGATORIO", "ADICIONAL_OBLIGATORIO", "BASE_POR_OPCION"] as const;
export const LO_ELEGIDO = ["DENTRO", "SIN_ELEGIR", "OPCION_FUERA", "PLATO_FUERA"] as const;
export const ESTADOS_DE_LA_OPCION = ["ACTIVA", "APAGADA"] as const;
export const ESTADOS_DEL_PLATO = ["DISPONIBLE", "APAGADO", "SIN_ORIGEN_DE_STOCK"] as const;
export const TOTALES_DE_LA_PARTE = ["BAJO_MIN", "EN_RANGO", "SOBRE_MAX"] as const;
export const REPETICIONES = ["DISTINTOS", "MISMO_PLATO_X2"] as const;
export const VERSIONES = ["VIGENTE", "VIEJA"] as const;

export interface Combinacion {
  modo: (typeof MODOS_DE_PARTE)[number];
  plato: (typeof TIPOS_DE_PLATO)[number];
  elegido: (typeof LO_ELEGIDO)[number];
  opcion: (typeof ESTADOS_DE_LA_OPCION)[number];
  estado: (typeof ESTADOS_DEL_PLATO)[number];
  total: (typeof TOTALES_DE_LA_PARTE)[number];
  repeticion: (typeof REPETICIONES)[number];
  version: (typeof VERSIONES)[number];
}

export type CausaDeRechazo = "NO_SE_OFRECE" | "FIJAS_CON_OPCIONES" | "CUPO_MIN" | "CUPO_MAX" | "OPCION_NO_PERMITIDA_EN_PROMO" | "OPCION_CAMBIO" | "OPCIONES_INVALIDAS" | "SIN_ORIGEN_DE_STOCK";

/** `peso`: el precio de lista con que pesa el plato en el reparto (`null` = lo fija la entrada, no el núcleo: «Solo estos platos» con opciones fijas). */
export type Esperado = { acepta: true; peso: number | null } | { acepta: false; causa: CausaDeRechazo };

/** Los precios de los platos del caso (el guardado y el de lista de cada configuración elegible), escritos a mano. */
export const PRECIO_DE_OTRO = 1500;
export const PRECIO_GUARDADO: Record<(typeof TIPOS_DE_PLATO)[number], number> = { SIN_GRUPOS: 18000, SOLO_OPCIONALES: 18000, CON_OBLIGATORIO: 18000, ADICIONAL_OBLIGATORIO: 18000, BASE_POR_OPCION: 9000 };

export function todasLasCombinaciones(): Combinacion[] {
  const salida: Combinacion[] = [];
  for (const modo of MODOS_DE_PARTE) for (const plato of TIPOS_DE_PLATO) for (const elegido of LO_ELEGIDO) for (const opcion of ESTADOS_DE_LA_OPCION) for (const estado of ESTADOS_DEL_PLATO)
    for (const total of TOTALES_DE_LA_PARTE) for (const repeticion of REPETICIONES) for (const version of VERSIONES) {
      salida.push({ modo, plato, elegido, opcion, estado, total, repeticion, version });
    }
  return salida;
}

/** Combinaciones que no pueden darse (ver arriba): se declaran y no se prueban. */
export function esImposible(c: Combinacion): boolean {
  return c.plato === "SIN_GRUPOS" && (c.elegido === "OPCION_FUERA" || c.opcion === "APAGADA");
}

/** ¿El mozo manda alguna opción? (DENTRO manda una del plato —salvo que no tenga—; OPCION_FUERA manda el adicional.) */
export function seMandaAlgunaOpcion(c: Combinacion): boolean {
  if (c.elegido === "OPCION_FUERA") return true;
  return c.elegido === "DENTRO" && c.plato !== "SIN_GRUPOS";
}

/** La unidad total de la parte (el mínimo es 3 y el máximo 4). */
export const UNIDADES: Record<(typeof TOTALES_DE_LA_PARTE)[number], number> = { BAJO_MIN: 2, EN_RANGO: 3, SOBRE_MAX: 5 };

/** El peso esperado de un plato aceptado que elige opciones (I8): el precio de lista de la configuración elegida, NUNCA el guardado. */
function pesoEsperado(c: Combinacion): number {
  if (c.plato === "SOLO_OPCIONALES") return c.elegido === "DENTRO" ? 18500 : 18000; // Mayo suma $ 500
  if (c.plato === "CON_OBLIGATORIO") return 20000; // Taza Grande: 18.000 + 2.000
  if (c.plato === "BASE_POR_OPCION") return 15000; // Tamaño Grande: precio final (el guardado, 9.000, no se cobra)
  return 18000; // SIN_GRUPOS
}

/** La tabla de reglas, tal cual está escrita arriba. */
export function esperado(c: Combinacion): Esperado {
  // R1
  const noSeOfrece =
    c.elegido === "PLATO_FUERA" ||
    c.estado === "APAGADO" ||
    c.plato === "ADICIONAL_OBLIGATORIO" ||
    (c.modo === "SOLO_ESTOS_A_ELEGIR" && c.plato === "SIN_GRUPOS") ||
    (c.modo !== "TODA_LA_SECCION" && c.estado === "SIN_ORIGEN_DE_STOCK");
  if (noSeOfrece) return { acepta: false, causa: "NO_SE_OFRECE" };
  // R3
  if (c.modo === "SOLO_ESTOS_FIJAS" && seMandaAlgunaOpcion(c)) return { acepta: false, causa: "FIJAS_CON_OPCIONES" };
  // R7
  if (c.total === "BAJO_MIN") return { acepta: false, causa: "CUPO_MIN" };
  if (c.total === "SOBRE_MAX") return { acepta: false, causa: "CUPO_MAX" };
  // «Solo estos platos» con opciones fijas: lo demás se acepta (lo que lleva lo fija la entrada).
  if (c.modo === "SOLO_ESTOS_FIJAS") return { acepta: true, peso: null };
  // R4
  if (c.elegido === "OPCION_FUERA" || (c.elegido === "DENTRO" && c.opcion === "APAGADA" && c.plato !== "SIN_GRUPOS")) return { acepta: false, causa: "OPCION_NO_PERMITIDA_EN_PROMO" };
  // R5
  if (seMandaAlgunaOpcion(c) && c.version === "VIEJA") return { acepta: false, causa: "OPCION_CAMBIO" };
  // R6
  if (c.elegido === "SIN_ELEGIR" && (c.plato === "CON_OBLIGATORIO" || c.plato === "BASE_POR_OPCION")) return { acepta: false, causa: "OPCIONES_INVALIDAS" };
  // R8
  if (c.estado === "SIN_ORIGEN_DE_STOCK") return { acepta: false, causa: "SIN_ORIGEN_DE_STOCK" };
  // R9
  return { acepta: true, peso: pesoEsperado(c) };
}

/**
 * GUARDIÁN: lo que cada valor de las listas cerradas que cambian qué entra en una parte significa para esta tabla. Si el sistema suma un tipo de parte, un modo de entrada o un tipo de grupo y no se declara acá,
 * `promo-parte-de-seccion-oraculo.test.ts` FALLA: hay que decidir si cambia lo que se acepta (entonces es una dimensión nueva) o declararlo sin efecto, con el motivo.
 */
export const TIPOS_DE_PARTE_DECLARADOS = {
  SECCION: "dimensión M = TODA_LA_SECCION",
  LISTA: "dimensión M = SOLO_ESTOS_FIJAS / SOLO_ESTOS_A_ELEGIR (según el modo de cada entrada)",
  DEL_DIA: "SIN EFECTO en esta tabla: el plato del día no lleva opciones (ADR-032:51), fuera de alcance del diseño",
} as const;

export const MODOS_DE_ENTRADA_DECLARADOS = {
  FIJAS: "dimensión M = SOLO_ESTOS_FIJAS",
  A_ELEGIR: "dimensión M = SOLO_ESTOS_A_ELEGIR",
} as const;

export const TIPOS_DE_GRUPO_DECLARADOS = {
  MEDIDA: "dimensión K = CON_OBLIGATORIO (en diferencia) y BASE_POR_OPCION (en absoluto)",
  VARIANTE: "dimensión K = SOLO_OPCIONALES y ADICIONAL_OBLIGATORIO (Salsa)",
  INCLUIDA: "se elige como una VARIANTE sin diferencia de precio: lo prueba aparte `plato-de-seccion.test.ts` (obligatoria y opcional), no entra al producto cartesiano",
  ADICIONAL: "dimensión X = OPCION_FUERA y K = ADICIONAL_OBLIGATORIO: nunca se ofrece (I3)",
} as const;
