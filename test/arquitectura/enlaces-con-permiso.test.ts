import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { RUTAS_FUERA_DEL_MENU, accionDeRuta, accionesDeNavegacion } from "../../src/core/navegacion/estructura";
import { ACCION_POR_PROCESO } from "../../src/core/movimientos/transiciones";
import { obtenerConfigProceso } from "../../src/core/movimientos/ui-config";

/**
 * Un enlace de una pantalla a OTRA pantalla que el rol del usuario no puede abrir termina en «no tenés permiso». Por eso los
 * enlaces entre pantallas con permisos distintos usan `EnlaceInterno` (deja el texto sin enlace si el rol no puede ver el
 * destino). Un `Link` a secas solo se admite hacia una pantalla que se protege con la MISMA acción que la pantalla donde está
 * (los enlaces de la propia familia: lista → ficha, paginación, «volver»).
 */
const RAIZ = join(__dirname, "../../src/app/(app)");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : ruta.endsWith(".tsx") ? [ruta] : [];
  });
}

/** La acción de «Ver» de la página dueña de un archivo: la de su `page.tsx` o, si no la tiene, la del `page.tsx` de la carpeta que lo contiene más cerca. */
function accionDeLaPantalla(archivo: string): string | null {
  let dir = dirname(archivo);
  while (dir.startsWith(RAIZ)) {
    try {
      const fuente = readFileSync(join(dir, "page.tsx"), "utf8");
      const literal = fuente.match(/requierePermisoVer(?:DeEmpresa)?\(\s*[^,]+,\s*[^,]+,\s*"(\w+)"/)?.[1];
      if (literal) return literal;
      if (fuente.includes("ACCION_POR_PROCESO")) return "por-proceso";
    } catch {
      // esta carpeta no tiene page.tsx: se sube
    }
    dir = dirname(dir);
  }
  return null;
}

describe("accionDeRuta", () => {
  it("resuelve por el ítem del menú de la ruta más larga, ignorando la consulta y el ancla", () => {
    expect(accionDeRuta("/reportes/historial?productoId=abc")).toBe("ver_reportes_operativos");
    expect(accionDeRuta("/reportes/trazabilidad?idOperacion=x#fila")).toBe("ver_reportes_operativos");
    expect(accionDeRuta("/reportes")).toBe("ver_reportes_dinero");
    expect(accionDeRuta("/reportes/rendimiento-recetas?productoId=1")).toBe("ver_reportes_dinero");
  });

  it("las rutas hijas de un ítem del menú usan la acción del ítem", () => {
    expect(accionDeRuta("/catalogo/recetas/cmu123")).toBe("guardar_receta");
    expect(accionDeRuta("/catalogo/recetas/cmu123/historial")).toBe("guardar_receta");
    expect(accionDeRuta("/catalogo/recetas/cmu123?editar=x&sugerido=2")).toBe("guardar_receta");
    expect(accionDeRuta("/movimientos/compra?productoId=p1")).toBe("proceso_compra");
    expect(accionDeRuta("/catalogo/productos?id=p1")).toBe("alta_producto");
    expect(accionDeRuta("/catalogo/productos/nuevo")).toBe("alta_producto");
    expect(accionDeRuta("/catalogo/productos/p1")).toBe("alta_producto");
    expect(accionDeRuta("/catalogo/productos/p1/editar")).toBe("alta_producto");
  });

  it("la comparativa de precios (fuera del menú) tiene su propia acción, distinta de la de Proveedores", () => {
    expect(accionDeRuta("/catalogo/proveedores")).toBe("proveedores");
    expect(accionDeRuta("/catalogo/proveedores?editar=p1")).toBe("proveedores");
    expect(accionDeRuta("/catalogo/proveedores/nuevo")).toBe("proveedores");
    expect(accionDeRuta("/catalogo/proveedores/p1")).toBe("proveedores");
    expect(accionDeRuta("/catalogo/proveedores/p1/editar")).toBe("proveedores");
    expect(accionDeRuta("/catalogo/proveedores/comparativa")).toBe("comparar_precios");
  });

  it("una ruta desconocida o la raíz no tienen acción", () => {
    expect(accionDeRuta("/")).toBeNull();
    expect(accionDeRuta("/login")).toBeNull();
    expect(accionDeRuta("/otra-cosa")).toBeNull();
  });

  it("la acción de cada ruta fuera del menú es la que pide su página, y se consulta al armar el conjunto de acciones visibles", () => {
    for (const item of RUTAS_FUERA_DEL_MENU) {
      const fuente = readFileSync(join(RAIZ, ...item.href.split("/").filter(Boolean), "page.tsx"), "utf8");
      expect(fuente.match(/requierePermisoVer(?:DeEmpresa)?\(\s*[^,]+,\s*[^,]+,\s*"(\w+)"/)?.[1], item.href).toBe(item.accion);
      expect(accionesDeNavegacion()).toContain(item.accion);
    }
  });
});

describe("los enlaces entre pantallas con permisos distintos usan EnlaceInterno", () => {
  const todos = archivos(RAIZ).filter((f) => !f.endsWith(`${sep}error.tsx`));

  it("encuentra archivos", () => {
    expect(todos.length).toBeGreaterThan(50);
  });

  it("todo `<Link href=…>` hacia una ruta estática va a una pantalla con la misma acción que la pantalla donde está", () => {
    const infractores: string[] = [];
    for (const archivo of todos) {
      const fuente = readFileSync(archivo, "utf8");
      const propia = accionDeLaPantalla(archivo);
      for (const m of fuente.matchAll(/<Link\b[^>]*?\shref=(?:"([^"]*)"|\{`([^`$]*)|\{([^}]+)\})/g)) {
        const enlace = `${relative(RAIZ, archivo).split(sep).join("/")}: ${m[0].slice(0, 90).replace(/\s+/g, " ")}`;
        const ruta = m[1] ?? m[2];
        if (ruta === undefined) {
          // href={expresión}: solo `volver` (la ficha de receta se vuelve a sí misma). Cualquier otro tiene que ir por EnlaceInterno.
          if (m[3].trim() !== "volver") infractores.push(`${enlace} (href dinámico: usá EnlaceInterno)`);
          continue;
        }
        if (!ruta.startsWith("/")) continue; // `${volver}/historial` (prefijo vacío), etc.
        const destino = accionDeRuta(ruta) ?? undefined;
        if (!destino) continue; // la raíz o una ruta sin acción conocida
        if (propia !== destino) infractores.push(`${enlace} (la pantalla pide «${propia}», el destino «${destino}»: usá EnlaceInterno)`);
      }
    }
    expect(infractores, `Links a otra pantalla con distinto permiso:\n${infractores.join("\n")}`).toEqual([]);
  });

  it("los enlaces de la ficha de receta que apuntan a `volver` son de la propia receta", () => {
    const fuente = readFileSync(join(RAIZ, "catalogo/recetas/[productoId]/page.tsx"), "utf8");
    expect(fuente).toMatch(/const volver = `\/catalogo\/recetas\/\$\{producto\.id\}`;/);
  });

  it("el proceso dinámico /movimientos/[proceso] toma su acción de ACCION_POR_PROCESO (no se compara por texto)", () => {
    const config = obtenerConfigProceso("compra");
    expect(config && ACCION_POR_PROCESO[config.proceso]).toBe("proceso_compra");
  });
});
