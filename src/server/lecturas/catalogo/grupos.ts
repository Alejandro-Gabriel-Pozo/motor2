import "server-only";
import { creariaCicloEnArbol, type NodoDeGrupo } from "@/core/catalogo/public";
import type { Db } from "@/lib/db-tipos";

/**
 * El árbol de grupos de insumos de la empresa, leído UNA vez y por id. Quien necesita la cadena de varios grupos (el stock por familia, la pantalla de
 * grupos) la arma sobre este mapa con `textoCadenaDeGruposEn` (core, puro) en vez de hacer una lectura por nivel y por grupo (Pureza Fase 3).
 * Sin guarda de permiso adentro: la página o la acción la pone antes. Vive en `server/lecturas` (ADR-026) porque la usan una página, una consulta y una acción.
 */
export async function cargarArbolDeGrupos(db: Db): Promise<Map<string, NodoDeGrupo>> {
  const grupos = await db.grupo.findMany({ select: { id: true, nombre: true, grupoPadreId: true } });
  return new Map(grupos.map((g) => [g.id, g]));
}

/** ¿Poner a `grupoId` bajo `padreNuevoId` crearía un ciclo? (un grupo no puede ser su propio ancestro). La decisión es pura; esto solo lee el árbol una vez. */
export async function creariaCiclo(grupoId: string, padreNuevoId: string | null, db: Db): Promise<boolean> {
  if (!padreNuevoId) return false; // sin padre = pasa a ser raíz, nunca hay ciclo
  return creariaCicloEnArbol(await cargarArbolDeGrupos(db), grupoId, padreNuevoId);
}
