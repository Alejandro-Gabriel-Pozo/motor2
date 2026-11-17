import "server-only";
import type { Db } from "@/lib/db-tipos";
import { consultarPortalDeEmpresa } from "@/server/lecturas/carta/portal-de-empresa";
import { cargarPortalEmpresaAdmin } from "./admin";

/**
 * Lo que la pantalla SIMPLE de «Colores del portal» necesita para abrirse (`components/carta/editor-colores-del-portal.tsx`): lo que dice la fila nueva del portal (si la empresa ya la tiene) y lo que ya tenía cargado en el Json de siempre. Solo lee.
 *
 * Los TRES COLORES salen SOLO de la fila (sin fila o con la columna vacía, «sin color»): así guardar sin tocarlos no cambia el portal (la lectura cae al Json donde la fila no cargó, `estiloDelPortalSimple`). Los dos TEXTOS salen de la fila y, donde está vacía, de lo que el
 * portal ya muestra (el Json): guardarlos tal cual da el mismo texto. `version` es la de la fila (`null` = la empresa no tiene portal nuevo: el guardado es el alta).
 */
export interface PortalSimpleParaLaPantalla {
  version: number | null;
  variante: "A" | "B";
  colorEncabezado: string | null;
  colorPagina: string | null;
  colorDetras: string | null;
  lineaSuperior: string;
  titulo: string;
  logoVisible: boolean;
  imagen: string;
  json: Record<string, string>;
}

export async function cargarPortalSimpleAdmin(db: Db, empresaId: string): Promise<PortalSimpleParaLaPantalla> {
  const [portal, apariencia] = await Promise.all([consultarPortalDeEmpresa(db, { empresaId }), cargarPortalEmpresaAdmin(db)]);
  const json = apariencia.valores;
  return {
    version: portal?.version ?? null,
    variante: portal?.variante ?? "A",
    colorEncabezado: portal?.colorEncabezado ?? null,
    colorPagina: portal?.colorPagina ?? null,
    colorDetras: portal?.colorDetras ?? null,
    lineaSuperior: portal?.lineaSuperior ?? json.portal_etiqueta ?? "",
    titulo: portal?.titulo ?? json.portal_titulo ?? "",
    logoVisible: portal?.logoVisible ?? true,
    imagen: portal?.imagen?.direccion ?? "",
    json,
  };
}
