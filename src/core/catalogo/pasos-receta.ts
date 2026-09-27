/**
 * Aritmética pura de reordenamiento de pasos de receta — sin base de datos.
 * `reordenarPasosDeReceta`/`insertarPasoEnReceta` (server/actions/catalogo/
 * recetas.ts) delegan acá y después llaman a `guardarReceta` con el
 * resultado, que genera la próxima versión (append-only, ver
 * docs/grounding-ficha-tecnica-tandoor.md, "Interacción con el versionado
 * append-only" — reordenar es un cambio de receta como cualquier otro).
 *
 * Dos invariantes que hay que preservar siempre, verificados con tests:
 * 1. `validarPasos` (receta-validacion.ts) rechaza dos pasos con el mismo `orden` en
 *    el mismo payload — por eso un reordenamiento es SIEMPRE una secuencia
 *    completa, nunca dos updates sueltos.
 * 2. Al reordenar hay que mover el objeto paso ENTERO (con su
 *    `insumoProductoIds`), no solo permutar los números de `orden` — si no,
 *    los ingredientes de cada paso quedarían atados al paso equivocado
 *    (`guardarReceta` matchea la tabla puente por `orden` en una segunda
 *    fase).
 */

/** Renumera 1..N en el orden del array — arregla los huecos que deja `quitarPasoDeReceta` (2,3,5 → 1,2,3). */
export function renumerar<T extends { orden: number }>(pasos: T[]): T[] {
  return pasos.map((p, i) => ({ ...p, orden: i + 1 }));
}

/** `secuencia` es una permutación exacta de `ordenesVigentes`: mismo multiset, sin faltantes ni repetidos. */
export function esPermutacionExacta(secuencia: number[], ordenesVigentes: number[]): boolean {
  if (secuencia.length !== ordenesVigentes.length) return false;
  const a = [...secuencia].sort((x, y) => x - y);
  const b = [...ordenesVigentes].sort((x, y) => x - y);
  return a.every((v, i) => v === b[i]);
}

/**
 * Reordena `pasos` según `secuencia` (lista de `orden` VIGENTES, en el orden
 * nuevo deseado) y renumera 1..N. Mueve el objeto paso entero — nunca solo
 * el número — para no desacoplar los ingredientes de su paso.
 */
export function aplicarSecuencia<T extends { orden: number }>(pasos: T[], secuencia: number[]): T[] {
  const porOrden = new Map(pasos.map((p) => [p.orden, p]));
  return renumerar(secuencia.map((orden) => porOrden.get(orden)).filter((p): p is T => p !== undefined));
}

/**
 * La secuencia resultante de mover un paso una posición. Si ya está en el
 * extremo (subir el primero, bajar el último) devuelve la MISMA secuencia
 * (sin cambios): el llamador puede compararla con la vigente y no guardar
 * nada, para no ensuciar el historial con una versión idéntica.
 */
export function secuenciaMoviendo(ordenesVigentes: number[], orden: number, direccion: "arriba" | "abajo"): number[] {
  const ordenados = [...ordenesVigentes].sort((a, b) => a - b);
  const i = ordenados.indexOf(orden);
  if (i === -1) return ordenados;
  const j = direccion === "arriba" ? i - 1 : i + 1;
  if (j < 0 || j >= ordenados.length) return ordenados;
  const copia = [...ordenados];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}

/**
 * Inserta `nuevo` en la posición 1-indexada `posicion` (recortada a
 * [1, N+1]) entre los `pasos` vigentes, y renumera 1..N+1. Los pasos
 * existentes conservan su instrucción e `insumoProductoIds` intactos —
 * solo cambia su `orden`.
 */
export function insertarEnPosicion<T extends { orden: number }>(pasos: T[], posicion: number, nuevo: T): T[] {
  const ordenados = [...pasos].sort((a, b) => a.orden - b.orden);
  const idx = Math.max(0, Math.min(posicion - 1, ordenados.length));
  const conNuevo = [...ordenados.slice(0, idx), nuevo, ...ordenados.slice(idx)];
  return renumerar(conNuevo);
}
