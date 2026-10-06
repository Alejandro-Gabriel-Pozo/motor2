import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GRUPOS_NAV } from "../../src/core/navegacion/estructura";
import { obtenerConfigProceso } from "../../src/core/movimientos/ui-config";
import { ACCION_POR_PROCESO } from "../../src/core/movimientos/transiciones";

/**
 * Todo ítem del menú lleva la acción de «Ver» que protege su página, y es LA MISMA que la página usa: si divergen, el menú
 * muestra enlaces que la página niega (o esconde pantallas que la persona sí puede abrir), y «a dónde mandar al entrar» (que
 * elige el primer ítem visible) llevaría a un mensaje de «no tenés permiso». Cubre todo el menú; los reportes tienen además su
 * propio test (reportes-con-permiso.test.ts).
 */
// Las pantallas viven en dos route groups: `(app)` (la administración, con el menú lateral) y `(pos)` (el salón, con su propio shell).
const RAICES = ["(app)", "(pos)"].map((grupo) => join(__dirname, "../../src/app", grupo));

/** La acción con la que se protege una ruta: la literal de su `page.tsx`, o la del proceso si es la ruta dinámica /movimientos/[proceso]. */
function accionDeLaPagina(href: string): string | undefined {
  const archivo = RAICES.map((raiz) => join(raiz, ...href.split("/").filter(Boolean), "page.tsx")).find((ruta) => existsSync(ruta));
  if (archivo) return readFileSync(archivo, "utf8").match(/requierePermisoVer(?:DeEmpresa)?\(\s*[^,]+,\s*[^,]+,\s*"(\w+)"/)?.[1];

  const slug = href.match(/^\/movimientos\/([^/]+)$/)?.[1];
  const config = slug ? obtenerConfigProceso(slug) : null;
  return config ? ACCION_POR_PROCESO[config.proceso] : undefined;
}

const items = GRUPOS_NAV.flatMap((g) => g.items);

describe("menú: cada ítem lleva la misma acción de Ver que su página", () => {
  it("hay ítems", () => {
    expect(items.length).toBeGreaterThan(40);
  });

  it.each(items.map((i) => [i.href, i] as const))("%s", (href, item) => {
    const clave = accionDeLaPagina(href);
    expect(clave, `No se pudo determinar la acción con la que ${href} se protege (¿falta requierePermisoVer en su página?)`).toBeDefined();
    expect(item.accion, `El ítem ${href} no tiene \`accion\` en el menú`).toBeDefined();
    expect(item.accion, `El menú usa "${item.accion}" para ${href}, pero la página se protege con "${clave}"`).toBe(clave);
  });
});
