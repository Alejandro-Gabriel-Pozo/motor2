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

/**
 * Las claves con las que una página de una entrada `algunaDe` llama a la guarda `requierePermisoVerDeAlguna(usuarioId, sucursalId, [claves…], db)`: las literales de la lista, o `undefined` si no la llama.
 * (Todavía ningún ítem del menú real es `algunaDe`: la comprobación contra la página real se completa cuando exista la entrada, P5a; acá se fija la lectura y se prueba con un texto sintético.)
 */
function clavesDeLaGuardaDeAlguna(fuente: string): string[] | undefined {
  const lista = fuente.match(/requierePermisoVerDeAlguna\(\s*[^,]+,\s*[^,]+,\s*\[([^\]]*)\]/)?.[1];
  return lista === undefined ? undefined : [...lista.matchAll(/"(\w+)"/g)].map((m) => m[1]);
}

/** El `page.tsx` de una ruta, o `undefined` si no existe. */
function paginaDe(href: string): string | undefined {
  return RAICES.map((raiz) => join(raiz, ...href.split("/").filter(Boolean), "page.tsx")).find((ruta) => existsSync(ruta));
}

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
    if (item.algunaDe) {
      // Entrada que reúne varias pantallas: la página llama a la guarda de «alguna de» con EXACTAMENTE las claves de la lista del ítem.
      const pagina = paginaDe(href);
      expect(pagina, `El ítem ${href} es \`algunaDe\` pero no tiene página en ${RAICES.join(" ni ")}`).toBeDefined();
      const claves = clavesDeLaGuardaDeAlguna(readFileSync(pagina as string, "utf8"));
      expect(claves, `La página de ${href} no llama a \`requierePermisoVerDeAlguna(usuarioId, sucursalId, [claves…], db)\` con una lista literal`).toBeDefined();
      expect([...(claves ?? [])].sort(), `El menú usa [${item.algunaDe.join(", ")}] para ${href}, pero la página se protege con [${(claves ?? []).join(", ")}]`).toEqual([...item.algunaDe].sort());
      return;
    }
    const clave = accionDeLaPagina(href);
    expect(clave, `No se pudo determinar la acción con la que ${href} se protege (¿falta requierePermisoVer en su página?)`).toBeDefined();
    expect(item.accion, `El ítem ${href} no tiene \`accion\` ni \`algunaDe\` en el menú`).toBeDefined();
    expect(item.accion, `El menú usa "${item.accion}" para ${href}, pero la página se protege con "${clave}"`).toBe(clave);
  });
});

describe("clavesDeLaGuardaDeAlguna (la lectura de la guarda de «alguna de» en una página)", () => {
  it("lee la lista literal de claves de la llamada", () => {
    const fuente = 'const g = await requierePermisoVerDeAlguna(ctx.usuarioId, ctx.sucursalId, ["proceso_ajuste", "proceso_consumo"], ctx.db);';
    expect(clavesDeLaGuardaDeAlguna(fuente)).toEqual(["proceso_ajuste", "proceso_consumo"]);
    expect(clavesDeLaGuardaDeAlguna('await requierePermisoVerDeAlguna(\n  u,\n  s,\n  [\n "proceso_ajuste",\n ],\n db)')).toEqual(["proceso_ajuste"]);
  });

  it("si la página no la llama (o usa otra guarda), da undefined", () => {
    expect(clavesDeLaGuardaDeAlguna('await requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "proceso_ajuste", ctx.db)')).toBeUndefined();
    expect(clavesDeLaGuardaDeAlguna("")).toBeUndefined();
  });
});
