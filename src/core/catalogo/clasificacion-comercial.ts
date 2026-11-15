import { nombreDeEleccionDesdeTexto } from "@/core/datos/fichas-de-texto";
import { invalido, valido, type ResultadoDeRegla } from "@/core/datos/resultado-de-regla";
import type { MotivoDeTextoInvalido } from "@/core/datos/texto-de-catalogo";

/**
 * REGLAS PURAS DE LA CLASIFICACIÓN COMERCIAL (departamento → categoría → niveles inferiores), iguales a las de Pedernal
 * (`src/primitivas/clasificacion/arbol.ts` y `nombre-de-nodo.ts`; la base de Pedernal las repite en `0045_clasificacion_comercial.sql`).
 * Diseño: docs/diseno-clasificacion-comercial-igual-a-pedernal-2026-11-13.md. Etapa: NÚCLEO PURO. Sin migración, sin tabla, sin Prisma, sin
 * reloj ni azar, y TODAVÍA NO conectado a ninguna pantalla ni acción: existe para fijar la regla en un solo lugar y recorrerla entera contra
 * el oráculo escrito aparte (`test/catalogo/clasificacion-comercial-oraculo.ts`).
 *
 * Reciben una FOTO del árbol de UNA empresa (id → nodo). Aislar por empresa es de quien arma la foto (la lectura filtra por empresa); acá
 * no hay datos de otra empresa porque no hay forma de pedirlos.
 *
 * Niveles: 1 = departamento (sin padre); 2 a `MAXIMO_DE_NIVELES_DE_CLASIFICACION` = categoría. El nivel NO se guarda: se calcula
 * recorriendo ancestros. El tope lo fija la plataforma UNA vez y nunca se reduce (reducirlo dejaría árboles que ya no lo cumplen).
 *
 * Todo nace cerrado (AGENTS.md, 2026-11-11): un árbol que no cumple (un padre que no existe, un ciclo, más niveles que el tope) NUNCA se
 * interpreta: la regla devuelve `ARBOL_INCONSISTENTE`. Los motivos de rechazo son un conjunto cerrado.
 *
 * Qué cubre la etapa con base (no está acá): el candado por empresa antes de leer la foto (dos movimientos a la vez no arman un ciclo),
 * el `id` que manda la app (repetir el alta no duplica), la versión del nodo al renombrar o mover, y los disparadores de la base como
 * defensa en profundidad con una prueba que compara el tope de la base con esta constante.
 */
export const MAXIMO_DE_NIVELES_DE_CLASIFICACION = 4;

export type NodoDeClasificacion = Readonly<{
  id: string;
  /** `null` = departamento (primer nivel). */
  padreId: string | null;
  activo: boolean;
  /** La clave de comparación del nombre (`claveDeNombre` del nombre ya canónico). Única entre hermanos, desactivados incluidos. */
  nombreClave: string;
}>;
export type ArbolDeClasificacion = ReadonlyMap<string, NodoDeClasificacion>;

/** Los motivos de rechazo: un conjunto CERRADO. Cada uno tendrá su mensaje cuando una etapa posterior conecte la regla. */
export const MOTIVOS_DE_RECHAZO_DE_CLASIFICACION = [
  "NODO_INEXISTENTE",
  "ARBOL_INCONSISTENTE",
  "PADRE_INEXISTENTE",
  "PADRE_DESACTIVADO",
  "CICLO",
  "TOPE_DE_NIVELES",
  "DEPARTAMENTO_NO_SE_MUEVE",
  "TIENE_HIJOS_ACTIVOS",
  "NOMBRE_REPETIDO_ENTRE_HERMANOS",
] as const;
export type MotivoDeRechazoDeClasificacion = (typeof MOTIVOS_DE_RECHAZO_DE_CLASIFICACION)[number];
export type MotivoDeArbol = Extract<MotivoDeRechazoDeClasificacion, "NODO_INEXISTENTE" | "ARBOL_INCONSISTENTE">;

/** El nombre de un nodo es el mismo texto que el de una sección de la carta (ficha ELECCION: 1 a 80, lista de permitidos, sin exigir una letra). */
export function nombreDeNodoDesdeTexto(texto: unknown): ResultadoDeRegla<string, MotivoDeTextoInvalido> {
  return nombreDeEleccionDesdeTexto(texto);
}

/**
 * Los ids del camino de un nodo, del departamento hasta el propio nodo (es lo que se copiará al renglón de venta). Un ciclo, un padre que
 * falta o más niveles que el tope no se interpretan: `ARBOL_INCONSISTENTE`.
 */
export function caminoDeNodo(arbol: ArbolDeClasificacion, id: string): ResultadoDeRegla<readonly string[], MotivoDeArbol> {
  let actual = arbol.get(id);
  if (actual === undefined) return invalido("NODO_INEXISTENTE");
  const camino = [id];
  while (actual.padreId !== null) {
    if (camino.length >= MAXIMO_DE_NIVELES_DE_CLASIFICACION) return invalido("ARBOL_INCONSISTENTE");
    actual = arbol.get(actual.padreId);
    if (actual === undefined) return invalido("ARBOL_INCONSISTENTE");
    camino.unshift(actual.id);
  }
  return valido(camino);
}

/** El nivel de un nodo (1 = departamento): el largo de su camino. */
export function nivelDeNodo(arbol: ArbolDeClasificacion, id: string): ResultadoDeRegla<number, MotivoDeArbol> {
  const camino = caminoDeNodo(arbol, id);
  return camino.ok ? valido(camino.valor.length) : camino;
}

/** La altura del subárbol que cuelga de un nodo, contando al propio nodo (1 = no tiene hijos, vivos o desactivados). */
function alturaDelSubarbol(arbol: ArbolDeClasificacion, id: string): ResultadoDeRegla<number, "ARBOL_INCONSISTENTE"> {
  // El padre de un departamento es `null`, que nunca está entre los ids de `actuales`: no hace falta mirarlo aparte.
  let actuales: ReadonlySet<string | null> = new Set([id]);
  let altura = 0;
  while (actuales.size > 0) {
    altura += 1;
    if (altura > MAXIMO_DE_NIVELES_DE_CLASIFICACION) return invalido("ARBOL_INCONSISTENTE");
    const siguientes = new Set<string | null>();
    for (const nodo of arbol.values()) {
      if (actuales.has(nodo.padreId)) siguientes.add(nodo.id);
    }
    actuales = siguientes;
  }
  return valido(altura);
}

/** ¿Hay ya un hermano (mismo padre, activo o no) con esa clave de nombre? `exceptoId` deja afuera al propio nodo (renombrar, mover). */
function hayHermanoConEseNombre(arbol: ArbolDeClasificacion, padreId: string | null, nombreClave: string, exceptoId: string | null): boolean {
  for (const nodo of arbol.values()) {
    if (nodo.id !== exceptoId && nodo.padreId === padreId && nodo.nombreClave === nombreClave) return true;
  }
  return false;
}

/**
 * ¿Se puede crear un nodo nuevo con ese nombre bajo ese padre? `null` = un departamento (siempre cabe en el árbol). El padre existe, está activo y su
 * nivel más uno no pasa el tope; y ningún hermano (desactivados incluidos) tiene la misma clave de nombre.
 */
export function puedeCrearBajo(
  arbol: ArbolDeClasificacion,
  padreId: string | null,
  nombreClave: string,
): ResultadoDeRegla<null, MotivoDeRechazoDeClasificacion> {
  if (padreId !== null) {
    const padre = arbol.get(padreId);
    if (padre === undefined) return invalido("PADRE_INEXISTENTE");
    if (!padre.activo) return invalido("PADRE_DESACTIVADO");
    const nivel = nivelDeNodo(arbol, padreId);
    if (!nivel.ok) return invalido("ARBOL_INCONSISTENTE");
    if (nivel.valor + 1 > MAXIMO_DE_NIVELES_DE_CLASIFICACION) return invalido("TOPE_DE_NIVELES");
  }
  return hayHermanoConEseNombre(arbol, padreId, nombreClave, null) ? invalido("NOMBRE_REPETIDO_ENTRE_HERMANOS") : valido(null);
}

/** ¿Se puede renombrar el nodo a esa clave? Existe y ningún OTRO hermano la tiene. Renombrar a su propia clave es válido (el caso de uso lo trata como «ya estaba»). */
export function puedeRenombrar(
  arbol: ArbolDeClasificacion,
  id: string,
  nombreClave: string,
): ResultadoDeRegla<null, MotivoDeRechazoDeClasificacion> {
  const nodo = arbol.get(id);
  if (nodo === undefined) return invalido("NODO_INEXISTENTE");
  return hayHermanoConEseNombre(arbol, nodo.padreId, nombreClave, id) ? invalido("NOMBRE_REPETIDO_ENTRE_HERMANOS") : valido(null);
}

/**
 * ¿Se puede mover un nodo (con todo lo que tiene adentro) bajo ese padre? Un departamento no se mueve (ni nadie pasa a primer nivel); el padre existe y
 * está activo; no es el propio nodo ni uno de sus descendientes (ciclo); el nivel del padre más la altura de lo que se mueve no pasa el tope; y ningún
 * hermano del destino tiene su nombre. Moverlo bajo el padre que ya tiene es válido (el caso de uso lo trata como «ya estaba»).
 */
export function puedeMover(arbol: ArbolDeClasificacion, id: string, nuevoPadreId: string): ResultadoDeRegla<null, MotivoDeRechazoDeClasificacion> {
  const nodo = arbol.get(id);
  if (nodo === undefined) return invalido("NODO_INEXISTENTE");
  if (nodo.padreId === null) return invalido("DEPARTAMENTO_NO_SE_MUEVE");
  const padre = arbol.get(nuevoPadreId);
  if (padre === undefined) return invalido("PADRE_INEXISTENTE");
  if (!padre.activo) return invalido("PADRE_DESACTIVADO");
  const camino = caminoDeNodo(arbol, nuevoPadreId);
  if (!camino.ok) return invalido("ARBOL_INCONSISTENTE");
  if (camino.valor.includes(id)) return invalido("CICLO");
  const altura = alturaDelSubarbol(arbol, id);
  if (!altura.ok) return altura;
  if (camino.valor.length + altura.valor > MAXIMO_DE_NIVELES_DE_CLASIFICACION) return invalido("TOPE_DE_NIVELES");
  return hayHermanoConEseNombre(arbol, nuevoPadreId, nodo.nombreClave, id) ? invalido("NOMBRE_REPETIDO_ENTRE_HERMANOS") : valido(null);
}

/** Los padres posibles de un nodo (lo que la pantalla deja elegir; el resto va apagado). Vacío si el nodo no se puede mover. */
export function destinosParaMover(arbol: ArbolDeClasificacion, id: string): ReadonlySet<string> {
  const destinos = new Set<string>();
  for (const candidato of arbol.keys()) {
    if (puedeMover(arbol, id, candidato).ok) destinos.add(candidato);
  }
  return destinos;
}

/** ¿Se puede desactivar? No con hijos activos («Primero desactivá lo que tiene adentro.»). */
export function puedeDesactivar(arbol: ArbolDeClasificacion, id: string): ResultadoDeRegla<null, MotivoDeRechazoDeClasificacion> {
  if (!arbol.has(id)) return invalido("NODO_INEXISTENTE");
  for (const nodo of arbol.values()) {
    if (nodo.padreId === id && nodo.activo) return invalido("TIENE_HIJOS_ACTIVOS");
  }
  return valido(null);
}

/** ¿Se puede reactivar? No si su padre está desactivado (no queda vivo lo que cuelga de algo desactivado). Un departamento siempre. */
export function puedeReactivar(arbol: ArbolDeClasificacion, id: string): ResultadoDeRegla<null, MotivoDeRechazoDeClasificacion> {
  const nodo = arbol.get(id);
  if (nodo === undefined) return invalido("NODO_INEXISTENTE");
  if (nodo.padreId === null) return valido(null);
  const padre = arbol.get(nodo.padreId);
  if (padre === undefined) return invalido("ARBOL_INCONSISTENTE");
  return padre.activo ? valido(null) : invalido("PADRE_DESACTIVADO");
}
