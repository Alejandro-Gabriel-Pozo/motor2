/**
 * ORÁCULO de combinaciones de UNA parte de promo (E2a de `docs/diseno-promo-parte-de-seccion-2026-11-11.md`; regla «Combinaciones» de AGENTS.md). Las reglas esperadas están escritas ACÁ, en una tabla legible y aparte del código: `parte-de-promo.test.ts`
 * recorre TODO el producto cartesiano de las dimensiones contra `planDeParte` + `motivoDeParteSinPlatos` y compara con `esperado`. La tabla no se genera del código. Es el hermano de `test/pos/promo-parte-de-seccion.oraculo.ts` (que dice qué se le acepta
 * al mozo; acá se dice qué queda guardado cuando el dueño elige qué entra en una parte).
 *
 * DIMENSIONES (las que cambian qué cupos quedan activos o si se rechaza):
 *   L  lugar             SECCION (una sección de la carta) · LISTA (una lista con nombre propio, «No está en la carta»)
 *   M  modo              NO_ENTRA · TODA («Toda la sección», solo con L = SECCION) · SOLO_ESTOS
 *   P  lo que había      NADA · ENTERA_ACTIVA · ENTERA_BAJA · LISTA_ACTIVA · LISTA_BAJA · AMBAS_ACTIVAS (herencia: no debería existir pero hoy puede) — «entera» = cupo SECCION, «lista» = cupo LISTA con el nombre de la sección
 *       Con L = LISTA solo cuentan LISTA_ACTIVA, LISTA_BAJA, NADA y dos casos de choque: HOMONIMA_ENTERA (una sección que se llama igual y entra entera) y OTRO_TIPO (un lugar «Plato del día» de otro tipo con ese nombre)
 *   A  platos tildados   NINGUNO · ALGUNO
 *   Q  cantidad          IGUAL (la que ya tenía) · OTRA · MIN_CERO (mínimo 0) — solo cambia si hay que reescribir el cupo o si I12b bloquea
 * Declaradas SIN efecto (no son dimensión): quién guarda (el permiso lo mira la acción, no el plan), la sucursal (la promo es de la empresa), el orden (se conserva), el modo de cada plato (lo decide `agregarEntradaDeCupo`).
 *
 * REGLAS (la primera que se cumple gana):
 *   R1  L = LISTA con M = TODA                                                                                          → imposible (el guard y el plan lo rechazan: «Toda la sección» es solo de una sección)
 *   R2  M = SOLO_ESTOS, A = NINGUNO y mínimo > 0                                                                       → BLOQUEADA (I12b, CONFIRMADA 2026-11-11)
 *   R3  L = LISTA, M = SOLO_ESTOS y hay una sección homónima que entra entera (P = HOMONIMA_ENTERA)                    → RECHAZADA (I10: «entera» y «solo estos» de una misma sección no conviven)
 *   R4  el nombre lo usa un lugar de otro tipo (P = OTRO_TIPO), con cualquier modo: ese lugar no se toca ni se confunde       → RECHAZADA
 *   R5  L = LISTA                                                                                                       → la lista queda activa solo con SOLO_ESTOS; una sección homónima que entra entera sigue como estaba
 *   R6  M = TODA                                                                                                        → sección activa, lista inactiva
 *   R7  M = SOLO_ESTOS                                                                                                  → lista activa, sección inactiva
 *   R8  M = NO_ENTRA                                                                                                    → las dos inactivas
 *   R9  pedir otra vez lo mismo no deja ninguna operación (por estado)
 */
export type Lugar = "SECCION" | "LISTA";
export type Modo = "NO_ENTRA" | "TODA" | "SOLO_ESTOS";
export type Previo = "NADA" | "ENTERA_ACTIVA" | "ENTERA_BAJA" | "LISTA_ACTIVA" | "LISTA_BAJA" | "AMBAS_ACTIVAS" | "HOMONIMA_ENTERA" | "OTRO_TIPO";
export type Platos = "NINGUNO" | "ALGUNO";
export type Cantidad = "IGUAL" | "OTRA" | "MIN_CERO";

export const LUGARES: readonly Lugar[] = ["SECCION", "LISTA"];
export const MODOS: readonly Modo[] = ["NO_ENTRA", "TODA", "SOLO_ESTOS"];
export const PREVIOS: readonly Previo[] = ["NADA", "ENTERA_ACTIVA", "ENTERA_BAJA", "LISTA_ACTIVA", "LISTA_BAJA", "AMBAS_ACTIVAS", "HOMONIMA_ENTERA", "OTRO_TIPO"];
export const PLATOS: readonly Platos[] = ["NINGUNO", "ALGUNO"];
export const CANTIDADES: readonly Cantidad[] = ["IGUAL", "OTRA", "MIN_CERO"];

export interface Caso {
  lugar: Lugar;
  modo: Modo;
  previo: Previo;
  platos: Platos;
  cantidad: Cantidad;
}

/** Imposibles (se declaran, no se prueban): lo que no puede existir o no se puede pedir. */
export function esImposible(c: Caso): boolean {
  if (c.lugar === "LISTA" && c.modo === "TODA") return true;
  // Los previos que solo tienen sentido para una sección.
  if (c.lugar === "LISTA" && ["ENTERA_ACTIVA", "ENTERA_BAJA", "AMBAS_ACTIVAS"].includes(c.previo)) return true;
  // Los de choque solo son de una lista con nombre propio.
  if (c.lugar === "SECCION" && ["HOMONIMA_ENTERA", "OTRO_TIPO"].includes(c.previo)) return true;
  // Sin platos o con mínimo 0 solo importa en SOLO_ESTOS (en los otros modos no hay platos): se descartan los repetidos.
  if (c.modo !== "SOLO_ESTOS" && c.platos === "ALGUNO") return true;
  return false;
}

export type Esperado = { rechazo: "BLOQUEADA" | "RECHAZADA"; seccionActiva?: never; listaActiva?: never } | { rechazo: null; seccionActiva: boolean; listaActiva: boolean };

export function esperado(c: Caso): Esperado {
  if (c.modo === "SOLO_ESTOS" && c.platos === "NINGUNO" && c.cantidad !== "MIN_CERO") return { rechazo: "BLOQUEADA" };
  if (c.lugar === "LISTA" && c.modo === "SOLO_ESTOS" && c.previo === "HOMONIMA_ENTERA") return { rechazo: "RECHAZADA" };
  if (c.previo === "OTRO_TIPO") return { rechazo: "RECHAZADA" };
  if (c.lugar === "LISTA") return { rechazo: null, seccionActiva: c.previo === "HOMONIMA_ENTERA", listaActiva: c.modo === "SOLO_ESTOS" };
  if (c.modo === "TODA") return { rechazo: null, seccionActiva: true, listaActiva: false };
  if (c.modo === "SOLO_ESTOS") return { rechazo: null, seccionActiva: false, listaActiva: true };
  return { rechazo: null, seccionActiva: false, listaActiva: false };
}
