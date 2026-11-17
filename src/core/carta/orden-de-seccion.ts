/**
 * Modo de orden de los renglones de una sección de carta, por sucursal (docs/diseno-carta-orden-permiso-y-precio-de-familia-2026-11-17.md, etapa O1). PURO: sin Prisma ni React.
 *
 * Dos modos, lista CERRADA (todo nace cerrado: lo que no es exactamente uno de los dos no es un modo):
 *  - `A_MANO`: por `orden` y, en un empate, por nombre. Es lo que la carta hace desde siempre.
 *  - `ALFABETICO`: por nombre; el `orden` guardado se ignora (pero NO se toca: se conserva para cuando se vuelva a «a mano»).
 *
 * SIN FILA = `A_MANO`: una sección sin modo cargado (o con un valor que acá no se conoce) se ordena como hoy, así que desplegar esto no cambia ninguna carta. Una regla, un lugar: `modoVigente` decide el modo y
 * `ordenarRenglonesDeSeccion` decide el orden; la carta pública (`armar-menu.ts`) y la lectura de gestión no vuelven a escribir ninguna de las dos reglas. ★ (`especial`) no participa: no es parte del orden.
 * El nombre que se compara es el que ve el comensal (el de la carta), con el mismo criterio de acentos y mayúsculas que ya usa el resto de la carta (`localeCompare` en español).
 */

/** Los modos de orden permitidos, en la lista cerrada que también exige la base (CHECK). */
export const MODOS_DE_ORDEN_DE_SECCION = ["ALFABETICO", "A_MANO"] as const;
export type ModoDeOrdenDeSeccion = (typeof MODOS_DE_ORDEN_DE_SECCION)[number];

/** Lo que vale cuando una sección no tiene modo cargado: lo que la carta hacía antes de existir el modo. */
export const MODO_DE_ORDEN_POR_DEFECTO: ModoDeOrdenDeSeccion = "A_MANO";

/** ¿El valor es exactamente uno de los modos permitidos? */
export function esModoDeOrdenDeSeccion(valor: unknown): valor is ModoDeOrdenDeSeccion {
  return typeof valor === "string" && (MODOS_DE_ORDEN_DE_SECCION as readonly string[]).includes(valor);
}

/** El modo que rige: el cargado si es uno permitido; ante la ausencia o cualquier otra cosa, `A_MANO` (falla cerrado al comportamiento de siempre). */
export function modoVigente(modoCargado: unknown): ModoDeOrdenDeSeccion {
  return esModoDeOrdenDeSeccion(modoCargado) ? modoCargado : MODO_DE_ORDEN_POR_DEFECTO;
}

/** La comparación de nombres de la carta (acentos y mayúsculas, en español). */
export function compararNombresDeCarta(a: string, b: string): number {
  return a.localeCompare(b, "es");
}

/**
 * La ÚNICA regla del orden de los renglones de una sección. `clave` dice, de cada renglón, su nombre (el de la carta) y su `orden`. Devuelve una lista NUEVA (no toca la entrada).
 * `ALFABETICO`: por nombre. Cualquier otro modo (incluido uno desconocido): `orden` y, en un empate, nombre. Productos sueltos e ítems agrupados comparten la misma escala.
 */
export function ordenarRenglonesDeSeccion<T>(renglones: readonly T[], modo: unknown, clave: (renglon: T) => { nombre: string; orden: number }): T[] {
  const alfabetico = modoVigente(modo) === "ALFABETICO";
  return [...renglones].sort((a, b) => {
    const ka = clave(a);
    const kb = clave(b);
    return alfabetico ? compararNombresDeCarta(ka.nombre, kb.nombre) : ka.orden - kb.orden || compararNombresDeCarta(ka.nombre, kb.nombre);
  });
}
