import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCIONES } from "../../src/core/permisos/acciones";
import { GRUPOS_NAV } from "../../src/core/navegacion/estructura";

/**
 * Cada página de /reportes tiene que estar protegida con una acción de «Ver», y esa acción tiene que ser la misma que el
 * menú usa para mostrarla u ocultarla (ítem con `accion` en GRUPOS_NAV). Antes, 18 de las 19 páginas no tenían ningún
 * permiso: cualquier usuario con sesión veía costos, márgenes y valuación. Si se agrega un reporte sin permiso, o el menú y la
 * página divergen (el enlace se muestra pero la página lo niega, o al revés), este test falla.
 */
const RAIZ = join(__dirname, "../../src/app/(app)/reportes");

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return paginas(ruta);
    return nombre === "page.tsx" ? [ruta] : [];
  });
}

const CLAVES = new Set(ACCIONES.map((a) => a.clave as string));
const itemsDelMenu = new Map(GRUPOS_NAV.flatMap((g) => g.items).map((i) => [i.href, i]));

describe("reportes: toda página lleva una acción de Ver y coincide con el menú", () => {
  const todas = paginas(RAIZ).map((ruta) => {
    const relativa = ruta.slice(RAIZ.length).split(sep).join("/").replace("/page.tsx", "");
    return { href: `/reportes${relativa}`, fuente: readFileSync(ruta, "utf8") };
  });

  it("encuentra las páginas de reportes", () => {
    expect(todas.length).toBeGreaterThan(15);
  });

  it.each(todas.map((p) => [p.href, p] as const))("%s", (_href, pagina) => {
    const clave = pagina.fuente.match(/requierePermisoVer(?:DeEmpresa)?\(\s*[^,]+,\s*[^,]+,\s*"(\w+)"/)?.[1];
    expect(clave, `${pagina.href} no llama a requierePermisoVer(..., "<acción>")`).toBeDefined();
    expect(CLAVES.has(clave as string), `${pagina.href} usa la acción "${clave}", que no está en ACCIONES`).toBe(true);

    const item = itemsDelMenu.get(pagina.href);
    expect(item, `${pagina.href} no está en el menú (GRUPOS_NAV)`).toBeDefined();
    expect(item?.accion, `El menú muestra ${pagina.href} con la acción "${item?.accion}" pero la página se protege con "${clave}"`).toBe(clave);
  });
});

/**
 * UNA clave por reporte: dos pantallas no comparten clave (si lo hicieran, darle acceso a una abriría la otra), y toda clave
 * `reporte_*` del catálogo la usa alguna pantalla. La única excepción es `reporte_historial_importes`, que no abre una pantalla: gobierna
 * si el Historial de un producto muestra los importes (la lee `obtenerMiNivelPermiso`).
 */
describe("reportes: una clave por pantalla", () => {
  const DE_PANTALLA = paginas(RAIZ).map((ruta) => {
    const fuente = readFileSync(ruta, "utf8");
    return { ruta, clave: fuente.match(/requierePermisoVer(?:DeEmpresa)?\(\s*[^,]+,\s*[^,]+,\s*"(\w+)"/)?.[1] };
  });
  const SIN_PANTALLA = ["reporte_historial_importes"];

  it("dos pantallas de reportes nunca comparten clave", () => {
    const repetidas = DE_PANTALLA.map((p) => p.clave).filter((c) => c?.startsWith("reporte_")).filter((c, i, todas) => todas.indexOf(c) !== i);
    expect(repetidas, "claves usadas por más de una pantalla").toEqual([]);
  });

  it("cada clave reporte_* del catálogo la usa una pantalla (salvo las que no abren pantalla)", () => {
    const usadas = new Set(DE_PANTALLA.map((p) => p.clave));
    const huerfanas = [...CLAVES].filter((c) => c.startsWith("reporte_") && !usadas.has(c) && !SIN_PANTALLA.includes(c));
    expect(huerfanas, "claves reporte_* que ninguna pantalla pide").toEqual([]);
  });

  // Consignación y Promociones viven bajo /reportes pero son pantallas de gestión (liquidar a un consignante, configurar promociones),
  // con su propia clave de operación: no se parten en un «reporte_*» aparte.
  const DE_GESTION = ["consignacion", "promociones"];

  it("toda pantalla de reportes usa una clave reporte_*, salvo las dos de gestión", () => {
    const ajenas = DE_PANTALLA.filter((p) => !p.clave?.startsWith("reporte_") && !DE_GESTION.some((g) => p.ruta.includes(sep + g + sep))).map((p) =>
      p.ruta.slice(RAIZ.length),
    );
    expect(ajenas, "pantallas de /reportes con una clave que no es reporte_*").toEqual([]);
  });
});
