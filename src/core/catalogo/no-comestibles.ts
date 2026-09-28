/**
 * «No comestibles» (packaging, limpieza, descartables): convención USAR (Uniform System of Accounts for Restaurants). El costo de lo
 * vendido (food cost) es SOLO comida y bebida; el packaging y los artículos de limpieza son gasto operativo directo y no entran en el
 * food cost ni en el ratio Compras/Ventas (decisión del usuario, 2026-09-18; docs/grounding-reportes-compras-2026-09-18.md §6).
 *
 * No hay un campo nuevo: un producto es no comestible si su Insumo pertenece al grupo llamado «No comestibles» o a cualquiera de sus
 * descendientes (ej. «Packaging» y «Limpieza» como hijos), en el árbol de Grupos de Catálogo → Insumos / Grupos. Si ese grupo no existe,
 * nada se excluye y los reportes se comportan como siempre (y avisan cómo activarlo).
 *
 * Este módulo es puro (sin base de datos) para poder usarlo desde los reportes y probarlo aparte.
 */
const NOMBRE_GRUPO_NO_COMESTIBLES = "No comestibles";

export interface NodoGrupo {
  nombre: string;
  grupoPadreId: string | null;
}

/** Minúsculas, sin tildes ni espacios sobrantes: «  No Comestibles » y «no comestíbles» son el mismo grupo. */
export function normalizarNombreGrupo(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const CLAVE_NO_COMESTIBLES = normalizarNombreGrupo(NOMBRE_GRUPO_NO_COMESTIBLES);

export interface ClasificacionNoComestibles {
  /** Existe al menos un grupo «No comestibles» (aunque todavía no tenga insumos). */
  existeGrupo: boolean;
  /** Ids del grupo «No comestibles» y de todos sus descendientes. */
  idsGrupos: Set<string>;
}

/**
 * Los grupos que cuentan como «no comestibles»: cada grupo llamado «No comestibles» y todos los que cuelgan de él, a cualquier profundidad.
 * Un ciclo en el árbol (un grupo que es su propio ancestro) no cuelga el cálculo.
 */
export function clasificarGruposNoComestibles(grupos: Map<string, NodoGrupo>): ClasificacionNoComestibles {
  const raices = [...grupos.entries()].filter(([, g]) => normalizarNombreGrupo(g.nombre) === CLAVE_NO_COMESTIBLES).map(([id]) => id);
  const idsGrupos = new Set<string>();

  for (const [id] of grupos) {
    let actual: string | null = id;
    const visitados = new Set<string>();
    while (actual !== null && !visitados.has(actual)) {
      if (raices.includes(actual)) {
        idsGrupos.add(id);
        break;
      }
      visitados.add(actual);
      actual = grupos.get(actual)?.grupoPadreId ?? null;
    }
  }

  return { existeGrupo: raices.length > 0, idsGrupos };
}
