import "server-only";
import type { NodoDeGrupo } from "@/core/catalogo/public";
import type { Db } from "@/lib/db-tipos";

/**
 * El árbol de grupos de insumos de la empresa, leído UNA vez y por id. Quien necesita la cadena de varios grupos (el stock por familia, la pantalla de
 * grupos) la arma sobre este mapa con `textoCadenaDeGruposEn` (core, puro) en vez de hacer una lectura por nivel y por grupo (Pureza Fase 3).
 * Sin guarda de permiso adentro: la página la pone antes.
 */
export async function cargarArbolDeGrupos(db: Db): Promise<Map<string, NodoDeGrupo>> {
  const grupos = await db.grupo.findMany({ select: { id: true, nombre: true, grupoPadreId: true } });
  return new Map(grupos.map((g) => [g.id, g]));
}
