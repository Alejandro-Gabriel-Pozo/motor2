import "server-only";
import { textoCadenaDeGruposEn } from "@/core/catalogo/public";
import { cargarArbolDeGrupos } from "@/server/lecturas/catalogo/grupos";
import type { Db } from "@/lib/db-tipos";

/**
 * La cadena legible de cada grupo («Lácteos › Quesos › Duros») para la pantalla de grupos de insumos: lee el árbol UNA vez (`cargarArbolDeGrupos`, la lectura compartida con el stock por familia
 * y con las acciones) y arma el texto de cada grupo con la función pura del dominio, en el orden de los ids que se piden. La pantalla pide a esta consulta y no importa `server/lecturas`
 * (regla `paginas-solo-consultas`, ADR-026). Sin guarda de permiso adentro: la página la pone antes.
 */
export async function cadenasDeGrupos(grupoIds: readonly string[], db: Db): Promise<string[]> {
  const arbol = await cargarArbolDeGrupos(db);
  return grupoIds.map((id) => textoCadenaDeGruposEn(arbol, id));
}
