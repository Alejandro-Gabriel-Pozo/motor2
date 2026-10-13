/**
 * La versión VIGENTE de una opción (GO-2b; ADR-030, decisión 2 y supuesto 1 del dueño): la de `numero` MAYOR, derivada, sin flag ni UPDATE (como `RecetaVersion`).
 * Dos versiones con el mismo número no pueden existir (único `(opcionId, numero)`). Pura: recibe las versiones ya leídas y devuelve la vigente, o `null` si no hay
 * ninguna (una opción sin versión no se puede vender: quien llama la deja afuera). Si el dueño elige después una fecha de vigencia (`rigeDesde`), este es el único
 * lugar que cambia.
 */
export function versionVigente<V extends { numero: number }>(versiones: readonly V[]): V | null {
  let vigente: V | null = null;
  for (const v of versiones) if (vigente === null || v.numero > vigente.numero) vigente = v;
  return vigente;
}
