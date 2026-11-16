import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUNTOS_DE_NOMBRE } from "./nombres-puntos-declarados";

/**
 * Guardián de los PUNTOS DE VALIDACIÓN DE NOMBRES (etapa E1; AGENTS.md «Combinaciones» y «Paridad con Pedernal»): recorre `src/` y falla si un archivo valida un nombre con la regla de Pedernal
 * (`nombreDeFicha`, `nombreMinimoDeFicha`, `nombreDeFichaSiCambio`) o con uno de los validadores viejos (`nombreDeCatalogo`, `validarTextoCatalogo`, `validarNombreCatalogo`,
 * `RE_TEXTO_CATALOGO`) y NO está declarado en `nombres-puntos-declarados.ts`, o si lo declarado ya no coincide con el código (fichas o validadores viejos distintos, archivo que ya no valida).
 * Además cada archivo declarado tiene que figurar en la tabla del documento del recuento (§5): la tabla y el código no se separan.
 * LÍMITES: lee texto, no tipos; una validación escrita con una expresión regular propia (no con estos nombres) no se ve (la cubre el cerco de lista de permitidos); un archivo que valida un nombre
 * llamando a otro validador sin estos nombres no se ve; no comprueba que la ficha elegida sea la correcta, solo que esté declarada.
 */
const USOS_VIEJOS = /\b(nombreDeCatalogo|validarTextoCatalogo|validarNombreCatalogo|RE_TEXTO_CATALOGO)\b/g;
const USOS_NUEVOS = /\b(nombreDeFicha|nombreMinimoDeFicha|nombreDeFichaSiCambio)\b/g;
const FICHAS = /"(PRODUCTO|ELECCION|RAZON_SOCIAL|NOMBRE_DE_SUCURSAL|NOMBRE_DE_ROL)"/g;
/** Donde se DEFINEN los validadores: no son puntos de validación. */
const DEFINICIONES = new Set(["src/core/texto.ts", "src/core/datos/nombre-catalogo.ts", "src/core/features/catalogo/nombre-de-catalogo.ts", "src/core/datos/nombre-de-ficha.ts"]);

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    return e.isDirectory() ? archivos(ruta) : /\.tsx?$/.test(e.name) ? [ruta.replaceAll("\\", "/")] : [];
  });
}

/** El código de un archivo sin los `import` ni los comentarios de línea o de bloque (lo que dicen los comentarios no es un uso). */
export function codigoSinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(import\s|\/\/)/.test(l))
    .join("\n");
}

export function usosEn(fuente: string): { pedernal: string[]; viejos: string[] } {
  const codigo = codigoSinComentarios(fuente);
  const nuevos = new Set([...codigo.matchAll(USOS_NUEVOS)].map((m) => m[1]!));
  const viejos = [...new Set([...codigo.matchAll(USOS_VIEJOS)].map((m) => m[1]!))].sort();
  return { pedernal: nuevos.size === 0 ? [] : [...new Set([...codigo.matchAll(FICHAS)].map((m) => m[1]!))].sort(), viejos };
}

describe("guardián de puntos de validación de nombres: el detector", () => {
  it("ve la regla de Pedernal con su ficha y los validadores viejos, y no ve comentarios ni imports", () => {
    expect(usosEn('import { nombreDeFicha } from "x";\nconst r = nombreDeFicha(v, "PRODUCTO", "a", "b");')).toEqual({ pedernal: ["PRODUCTO"], viejos: [] });
    expect(usosEn("const r = validarTextoCatalogo(v, e);\nnombreDeCatalogo(v, a, b);")).toEqual({ pedernal: [], viejos: ["nombreDeCatalogo", "validarTextoCatalogo"] });
    expect(usosEn('// nombreDeFicha(v, "PRODUCTO")\n/* validarTextoCatalogo(v) */\nconst x = 1;')).toEqual({ pedernal: [], viejos: [] });
  });
});

describe("guardián de puntos de validación de nombres: el código coincide con la tabla declarada", () => {
  const delCodigo = new Map<string, { pedernal: string[]; viejos: string[] }>();
  for (const ruta of archivos("src")) {
    if (DEFINICIONES.has(ruta)) continue;
    const usos = usosEn(readFileSync(ruta, "utf8"));
    if (usos.pedernal.length > 0 || usos.viejos.length > 0 || /\b(nombreDeFicha|nombreMinimoDeFicha|nombreDeFichaSiCambio)\b/.test(codigoSinComentarios(readFileSync(ruta, "utf8")))) delCodigo.set(ruta, usos);
  }

  it("la búsqueda encuentra puntos (no mira un árbol vacío)", () => {
    expect(delCodigo.size).toBeGreaterThan(15);
  });

  it("todo punto del código está declarado (un punto de validación de nombre nuevo sin declarar falla)", () => {
    const sinDeclarar = [...delCodigo.keys()].filter((r) => !(r in PUNTOS_DE_NOMBRE)).sort();
    expect(sinDeclarar, "declaralos en test/arquitectura/nombres-puntos-declarados.ts (y en la tabla del documento del recuento, §5)").toEqual([]);
  });

  it("todo punto declarado sigue existiendo en el código", () => {
    const viejos = Object.keys(PUNTOS_DE_NOMBRE).filter((r) => !delCodigo.has(r)).sort();
    expect(viejos).toEqual([]);
  });

  it.each(Object.entries(PUNTOS_DE_NOMBRE))("%s: las fichas y los validadores viejos son los declarados", (ruta, punto) => {
    const real = delCodigo.get(ruta);
    expect(real, ruta).toBeDefined();
    expect(real!.pedernal).toEqual([...punto.pedernal].sort());
    expect(real!.viejos).toEqual([...punto.viejos].sort());
  });

  it("todo punto con un validador viejo y sin ficha lleva escrito qué hace Pedernal (la evidencia para decidir)", () => {
    for (const [ruta, punto] of Object.entries(PUNTOS_DE_NOMBRE)) {
      if (punto.viejos.length > 0) expect(punto.pedernalHace, ruta).toBeTruthy();
    }
  });

  it("cada archivo declarado figura en la tabla de puntos del documento del recuento (§5)", () => {
    const doc = readFileSync("docs/e1-recuento-de-textos-y-cuit-2026-11-15.md", "utf8");
    const seccion = doc.slice(doc.indexOf("## 5."), doc.indexOf("## 6."));
    const faltan = Object.keys(PUNTOS_DE_NOMBRE).filter((r) => !seccion.includes(r.replace(/^src\//, "")));
    expect(faltan).toEqual([]);
  });
});
