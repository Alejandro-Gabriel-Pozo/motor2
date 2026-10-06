/**
 * La cadena de un grupo de insumos sobre el árbol YA LEÍDO (Pureza Fase 3): puro, sin base. La versión que consulta (`textoCadenaDeGrupos` en `grupo.ts`)
 * hace una lectura por nivel y por grupo; quien necesita la cadena de muchos grupos lee el árbol UNA vez (`cargarArbolDeGrupos`) y la arma acá.
 */
export interface NodoDeGrupo {
  id: string;
  nombre: string;
  grupoPadreId: string | null;
}

/**
 * Equivalente de creariaCicloGrupo_ (Catalogo.js:2483-2489) sobre el árbol YA LEÍDO: un grupo no puede ser su propio ancestro. Cubre la auto-referencia directa
 * (`padreNuevoId === grupoId`) y el ciclo indirecto (el padre propuesto ya desciende de este grupo). Sin padre (`null`) pasa a ser raíz: nunca hay ciclo.
 */
export function creariaCicloEnArbol(arbol: ReadonlyMap<string, NodoDeGrupo>, grupoId: string, padreNuevoId: string | null): boolean {
  if (!padreNuevoId) return false;
  if (padreNuevoId === grupoId) return true;

  const vistos = new Set<string>();
  let actualId: string | null = padreNuevoId;
  while (actualId && !vistos.has(actualId)) {
    if (actualId === grupoId) return true;
    vistos.add(actualId);
    actualId = arbol.get(actualId)?.grupoPadreId ?? null;
  }
  return false;
}

/**
 * Breadcrumb legible "Bebidas > Bebidas sin alcohol" (raíz primero), equivalente de textoCadenaDeGrupos_ (Catalogo.js:2477-2480). Sube de hijo a raíz
 * siguiendo `grupoPadreId` y corta si repite un id ya visto (protección extra contra un ciclo colado a mano en la base) o si falta la fila: igual que
 * la versión que consulta. Un grupo que no está en el árbol da "".
 */
export function textoCadenaDeGruposEn(arbol: ReadonlyMap<string, NodoDeGrupo>, grupoId: string): string {
  const cadena: string[] = [];
  const vistos = new Set<string>();
  let actualId: string | null = grupoId;
  while (actualId && !vistos.has(actualId)) {
    vistos.add(actualId);
    const grupo: NodoDeGrupo | undefined = arbol.get(actualId);
    if (!grupo) break;
    cadena.push(grupo.nombre);
    actualId = grupo.grupoPadreId;
  }
  return cadena.reverse().join(" > ");
}
