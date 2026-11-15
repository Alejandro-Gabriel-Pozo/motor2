/**
 * ORÁCULO de la clasificación comercial (docs/diseno-clasificacion-comercial-igual-a-pedernal-2026-11-13.md; regla de combinaciones del
 * 2026-10-28): las reglas esperadas ESCRITAS APARTE del código, como tabla legible (REGLAS) más una forma independiente de calcularlas.
 * NO importa nada de `src/core/catalogo/clasificacion-comercial.ts` más que los TIPOS y el tope: si importara la lógica, el test compararía el
 * código consigo mismo. A propósito calcula distinto: ascendientes con una lista y un conjunto de visitados (el código usa un tope de pasos), y
 * la altura del subárbol con una búsqueda en profundidad sobre una tabla de hijos (el código recorre por niveles).
 *
 * Cada caso devuelve la regla que lo decide (`id`) y lo esperado. El test exige que cada regla de la tabla se ejerza al menos una vez.
 * El ORDEN de los chequeos es parte de la regla (es el de Pedernal: el primer motivo que aplica es el que se informa).
 */
import type { ArbolDeClasificacion, MotivoDeRechazoDeClasificacion } from "@/core/catalogo/clasificacion-comercial";
import { MAXIMO_DE_NIVELES_DE_CLASIFICACION as TOPE } from "@/core/catalogo/clasificacion-comercial";

export type Esperado = "permitido" | MotivoDeRechazoDeClasificacion;
export interface Decision {
  readonly regla: string;
  readonly esperado: Esperado;
}

export const REGLAS: Readonly<Record<string, string>> = {
  "V-1": "El camino/nivel de un nodo que no existe es NODO_INEXISTENTE.",
  "V-2": "Un nodo cuya cadena de padres tiene un ciclo, un padre que falta o más niveles que el tope es ARBOL_INCONSISTENTE: nunca se interpreta.",
  "V-3": "En un árbol sano el camino va del departamento al nodo y el nivel es su largo (departamento = 1).",
  "C-1": "Crear bajo un padre inexistente se rechaza: PADRE_INEXISTENTE.",
  "C-2": "Crear bajo un padre desactivado se rechaza: PADRE_DESACTIVADO.",
  "C-3": "Crear bajo un padre cuya cadena es inconsistente se rechaza: ARBOL_INCONSISTENTE.",
  "C-4": "Crear bajo un padre del último nivel se rechaza: TOPE_DE_NIVELES.",
  "C-5": "Crear con la misma clave de nombre que un hermano (activo o desactivado) se rechaza: NOMBRE_REPETIDO_ENTRE_HERMANOS.",
  "C-6": "Si no aplica nada de lo anterior se puede crear (un departamento cuenta como hermano de los demás departamentos).",
  "M-1": "Mover un nodo que no existe se rechaza: NODO_INEXISTENTE.",
  "M-2": "Un departamento no se mueve: DEPARTAMENTO_NO_SE_MUEVE.",
  "M-3": "Mover bajo un padre inexistente: PADRE_INEXISTENTE.",
  "M-4": "Mover bajo un padre desactivado: PADRE_DESACTIVADO.",
  "M-5": "Mover bajo un padre cuya cadena es inconsistente: ARBOL_INCONSISTENTE.",
  "M-6": "Mover un nodo bajo sí mismo o bajo un descendiente: CICLO.",
  "M-7": "Si lo que se mueve tiene un subárbol inconsistente (ciclo o más niveles que el tope): ARBOL_INCONSISTENTE.",
  "M-8": "Si el nivel del nuevo padre más la altura de lo que se mueve pasa el tope: TOPE_DE_NIVELES.",
  "M-9": "Si un hermano del destino tiene la misma clave de nombre: NOMBRE_REPETIDO_ENTRE_HERMANOS.",
  "M-10": "Si no aplica nada de lo anterior se puede mover (también bajo el padre que ya tiene).",
  "D-1": "Desactivar un nodo que no existe: NODO_INEXISTENTE.",
  "D-2": "Desactivar un nodo con algún hijo activo: TIENE_HIJOS_ACTIVOS (los hijos desactivados no impiden).",
  "D-3": "Sin hijos activos se puede desactivar.",
  "A-1": "Reactivar un nodo que no existe: NODO_INEXISTENTE.",
  "A-2": "Un departamento siempre se puede reactivar.",
  "A-3": "Reactivar un nodo cuyo padre no existe: ARBOL_INCONSISTENTE.",
  "A-4": "Reactivar un nodo cuyo padre está desactivado: PADRE_DESACTIVADO.",
  "A-5": "Con el padre activo se puede reactivar.",
  "N-1": "Renombrar un nodo que no existe: NODO_INEXISTENTE.",
  "N-2": "Renombrar a la clave de OTRO hermano (activo o desactivado): NOMBRE_REPETIDO_ENTRE_HERMANOS.",
  "N-3": "Renombrar a una clave libre, o a la propia, se puede.",
};

const decide = (regla: string, esperado: Esperado): Decision => ({ regla, esperado });

type Cadena = { readonly ok: true; readonly camino: readonly string[] } | { readonly ok: false; readonly motivo: "NODO_INEXISTENTE" | "ARBOL_INCONSISTENTE" };

/** Ascendientes con una lista y un conjunto de visitados: un ciclo es «volver a un nodo ya visto». */
function cadenaDe(arbol: ArbolDeClasificacion, id: string): Cadena {
  if (!arbol.has(id)) return { ok: false, motivo: "NODO_INEXISTENTE" };
  const vistos = new Set<string>();
  const haciaArriba: string[] = [];
  let actual: string | null = id;
  while (actual !== null) {
    if (vistos.has(actual)) return { ok: false, motivo: "ARBOL_INCONSISTENTE" };
    const nodo = arbol.get(actual);
    if (nodo === undefined) return { ok: false, motivo: "ARBOL_INCONSISTENTE" };
    vistos.add(actual);
    haciaArriba.push(actual);
    actual = nodo.padreId;
  }
  if (haciaArriba.length > TOPE) return { ok: false, motivo: "ARBOL_INCONSISTENTE" };
  return { ok: true, camino: haciaArriba.reverse() };
}

/** Altura del subárbol (el nodo cuenta 1) por búsqueda en profundidad; `null` si pasa el tope o vuelve sobre sí. */
function alturaDe(arbol: ArbolDeClasificacion, id: string): number | null {
  const hijos = new Map<string, string[]>();
  for (const n of arbol.values()) {
    if (n.padreId === null) continue;
    hijos.set(n.padreId, [...(hijos.get(n.padreId) ?? []), n.id]);
  }
  const bajar = (nodo: string, vistos: ReadonlySet<string>): number | null => {
    if (vistos.has(nodo) || vistos.size >= TOPE) return null;
    const hasta = new Set(vistos).add(nodo);
    let mayor = 0;
    for (const h of hijos.get(nodo) ?? []) {
      const alt = bajar(h, hasta);
      if (alt === null) return null;
      mayor = Math.max(mayor, alt);
    }
    return mayor + 1;
  };
  return bajar(id, new Set());
}

const hermanoConClave = (arbol: ArbolDeClasificacion, padreId: string | null, clave: string, excepto: string | null): boolean =>
  [...arbol.values()].some((n) => n.id !== excepto && n.padreId === padreId && n.nombreClave === clave);

export function esperadoCamino(arbol: ArbolDeClasificacion, id: string): Decision & { readonly camino?: readonly string[] } {
  const c = cadenaDe(arbol, id);
  if (!c.ok) return decide(c.motivo === "NODO_INEXISTENTE" ? "V-1" : "V-2", c.motivo);
  return { ...decide("V-3", "permitido"), camino: c.camino };
}

export function esperadoCrear(arbol: ArbolDeClasificacion, padreId: string | null, clave: string): Decision {
  if (padreId !== null) {
    const padre = arbol.get(padreId);
    if (padre === undefined) return decide("C-1", "PADRE_INEXISTENTE");
    if (!padre.activo) return decide("C-2", "PADRE_DESACTIVADO");
    const c = cadenaDe(arbol, padreId);
    if (!c.ok) return decide("C-3", "ARBOL_INCONSISTENTE");
    if (c.camino.length >= TOPE) return decide("C-4", "TOPE_DE_NIVELES");
  }
  return hermanoConClave(arbol, padreId, clave, null) ? decide("C-5", "NOMBRE_REPETIDO_ENTRE_HERMANOS") : decide("C-6", "permitido");
}

export function esperadoMover(arbol: ArbolDeClasificacion, id: string, destinoId: string): Decision {
  const nodo = arbol.get(id);
  if (nodo === undefined) return decide("M-1", "NODO_INEXISTENTE");
  if (nodo.padreId === null) return decide("M-2", "DEPARTAMENTO_NO_SE_MUEVE");
  const destino = arbol.get(destinoId);
  if (destino === undefined) return decide("M-3", "PADRE_INEXISTENTE");
  if (!destino.activo) return decide("M-4", "PADRE_DESACTIVADO");
  const c = cadenaDe(arbol, destinoId);
  if (!c.ok) return decide("M-5", "ARBOL_INCONSISTENTE");
  if (c.camino.includes(id)) return decide("M-6", "CICLO");
  const altura = alturaDe(arbol, id);
  if (altura === null) return decide("M-7", "ARBOL_INCONSISTENTE");
  if (c.camino.length + altura > TOPE) return decide("M-8", "TOPE_DE_NIVELES");
  return hermanoConClave(arbol, destinoId, nodo.nombreClave, id) ? decide("M-9", "NOMBRE_REPETIDO_ENTRE_HERMANOS") : decide("M-10", "permitido");
}

export function esperadoDesactivar(arbol: ArbolDeClasificacion, id: string): Decision {
  if (!arbol.has(id)) return decide("D-1", "NODO_INEXISTENTE");
  const conHijoActivo = [...arbol.values()].some((n) => n.padreId === id && n.activo);
  return conHijoActivo ? decide("D-2", "TIENE_HIJOS_ACTIVOS") : decide("D-3", "permitido");
}

export function esperadoReactivar(arbol: ArbolDeClasificacion, id: string): Decision {
  const nodo = arbol.get(id);
  if (nodo === undefined) return decide("A-1", "NODO_INEXISTENTE");
  if (nodo.padreId === null) return decide("A-2", "permitido");
  const padre = arbol.get(nodo.padreId);
  if (padre === undefined) return decide("A-3", "ARBOL_INCONSISTENTE");
  return padre.activo ? decide("A-5", "permitido") : decide("A-4", "PADRE_DESACTIVADO");
}

export function esperadoRenombrar(arbol: ArbolDeClasificacion, id: string, clave: string): Decision {
  const nodo = arbol.get(id);
  if (nodo === undefined) return decide("N-1", "NODO_INEXISTENTE");
  return hermanoConClave(arbol, nodo.padreId, clave, id) ? decide("N-2", "NOMBRE_REPETIDO_ENTRE_HERMANOS") : decide("N-3", "permitido");
}

/** Los destinos esperados de un movimiento: los candidatos del árbol (cualquier id, incluido el propio nodo) que el oráculo permite. */
export function esperadoDestinos(arbol: ArbolDeClasificacion, id: string): ReadonlySet<string> {
  return new Set([...arbol.keys()].filter((candidato) => esperadoMover(arbol, id, candidato).esperado === "permitido"));
}
