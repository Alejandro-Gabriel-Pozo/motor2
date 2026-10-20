import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cerco del RETIRO DE GO-3a (Fase 3 de la ola «precio y carta», paso 3.5; DEC-02 y DEC-16): las combinaciones por producto, la tarifa compartida (`GrupoDePrecio`) y la receta propia por
 * combinación se retiraron del código y no vuelven por la puerta de atrás. Ningún archivo de `src/`, `plataforma/` ni `scripts/` nombra sus modelos, su columna, su clave de permiso, sus rutas
 * ni sus símbolos (el texto se mira SIN comentarios: un comentario que cuenta la historia está permitido; código, strings y tipos, no). Y el esquema de Prisma ya no declara la columna
 * `ProductoAdmiteGrupo.ejeDeCombinacion` (la base la conserva hasta la migración de retiro, que va en un PR aparte: con el campo fuera del modelo, ningún `create` ni lectura sin `select` la pide).
 *
 * Los 6 MODELOS de GO-3a siguen en el esquema hasta esa migración (el cliente de Prisma los conoce); el cerco exige que ningún código los use. La migración de retiro suma a este cerco el
 * chequeo de que tampoco estén en el esquema.
 */
const RAIZ = join(__dirname, "../..");
const CARPETAS = ["src", "plataforma", "scripts"];

/** Lo retirado, con por qué. Cada patrón se busca en el código sin comentarios. */
const RETIRADO: readonly { patron: RegExp; que: string }[] = [
  { patron: /\b(GrupoDePrecio|grupoDePrecio)\w*/, que: "la tarifa compartida (GrupoDePrecio)" },
  { patron: /\b(CombinacionDeProducto|combinacionDeProducto)\b/, que: "la combinación de un producto (CombinacionDeProducto)" },
  { patron: /\b(PrecioLocalDeCombinacion|precioLocalDeCombinacion)\w*/, que: "el precio local de una combinación" },
  { patron: /\b(RecetaDeCombinacion|recetaDeCombinacion)\w*/, que: "la receta propia de una combinación" },
  { patron: /\b(CombinacionEnLinea|combinacionEnLinea)\b/, que: "la foto de la combinación vendida" },
  { patron: /\bejeDeCombinacion\b/, que: "la columna ProductoAdmiteGrupo.ejeDeCombinacion" },
  { patron: /\bgrupos_de_precio_definir\b/, que: "la clave de permiso de las tarifas" },
  { patron: /\/catalogo\/tarifas\b/, que: "la pantalla de tarifas" },
  { patron: /\/productos\/[^"'`\s]*\/combinaciones\b/, que: "la pantalla de combinaciones de un producto" },
  { patron: /\b(COMBINACION_NO_DISPONIBLE|PRECIO_DE_COMBINACION_INVALIDO)\b/, que: "los rechazos de la venta por combinación" },
  { patron: /\b(resumenDePreciosConCombinaciones|opcionesConCombinacionApagada|combinacionElegida|combinacionesParaMostrar|cargarCombinacionesParaVender|ExcepcionDeCombinacion)\b/, que: "la venta y la vista previa con combinaciones" },
];

function archivos(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((nombre) => {
    if (nombre === "node_modules" || nombre === ".next") return [];
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx|mts|cts|js|mjs|cjs|sql)$/.test(nombre) ? [ruta] : [];
  });
}

/** El texto sin comentarios (`//`, `/* *\/` y `--` de SQL), conservando lo que está dentro de un string. */
function sinComentarios(fuente: string, sql = false): string {
  const sinBloques = fuente.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, " "));
  const sinLinea = sinBloques.replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
  return sql ? sinLinea.replace(/--.*$/gm, "") : sinLinea;
}

function hallazgos(texto: string): string[] {
  return RETIRADO.filter((r) => r.patron.test(texto)).map((r) => r.que);
}

describe("GO-3a retirado (Fase 3 de la ola «precio y carta»): nada lo nombra en el código", () => {
  const fuentes = CARPETAS.flatMap((c) => archivos(join(RAIZ, c))).map((ruta) => ({ ruta: relative(RAIZ, ruta).split(sep).join("/"), texto: readFileSync(ruta, "utf8") }));

  it("recorre el código de verdad (src, plataforma y scripts)", () => {
    expect(fuentes.filter((f) => f.ruta.startsWith("src/")).length).toBeGreaterThan(500);
    expect(fuentes.some((f) => f.ruta.startsWith("scripts/"))).toBe(true);
  });

  it("ningún archivo de src/, plataforma/ ni scripts/ nombra lo retirado (fuera de un comentario)", () => {
    const malos = fuentes.flatMap((f) => hallazgos(sinComentarios(f.texto, f.ruta.endsWith(".sql"))).map((que) => `${f.ruta}: ${que}`));
    expect(malos, `GO-3a se retiró en la Fase 3 (ADR-032, «Fase 3: retiro de GO-3a»): no vuelve sin una decisión nueva.\n${malos.join("\n")}`).toEqual([]);
  });

  it("el modelo de Prisma ya no declara ProductoAdmiteGrupo.ejeDeCombinacion (la columna se borra con la migración de retiro)", () => {
    const schema = sinComentarios(readFileSync(join(RAIZ, "prisma/schema.prisma"), "utf8"));
    const modelo = /^model\s+ProductoAdmiteGrupo\s*\{([\s\S]*?)^\}/m.exec(schema);
    expect(modelo, "el modelo ProductoAdmiteGrupo existe").not.toBeNull();
    expect(modelo![1]).not.toMatch(/\bejeDeCombinacion\b/);
  });

  it("el detector ve lo retirado en código y en strings, y no en un comentario", () => {
    expect(hallazgos(sinComentarios("await tx.combinacionDeProducto.findMany({})"))).toEqual(["la combinación de un producto (CombinacionDeProducto)"]);
    expect(hallazgos(sinComentarios('select: { ejeDeCombinacion: true }'))).toEqual(["la columna ProductoAdmiteGrupo.ejeDeCombinacion"]);
    expect(hallazgos(sinComentarios('conPermisoDeEmpresa("grupos_de_precio_definir", f)'))).toEqual(["la clave de permiso de las tarifas"]);
    expect(hallazgos(sinComentarios('<a href="/catalogo/tarifas">'))).toEqual(["la pantalla de tarifas"]);
    expect(hallazgos(sinComentarios("href={`/catalogo/productos/${id}/combinaciones`}"))).toEqual(["la pantalla de combinaciones de un producto"]);
    expect(hallazgos(sinComentarios('DELETE FROM "GrupoDePrecio"', true))).toEqual(["la tarifa compartida (GrupoDePrecio)"]);
    expect(hallazgos(sinComentarios("// antes: tx.grupoDePrecio.findMany\n/* CombinacionEnLinea */\nconst x = 1;"))).toEqual([]);
    expect(hallazgos(sinComentarios("-- GrupoDePrecio\nSELECT 1;", true))).toEqual([]);
    expect(hallazgos(sinComentarios("const combinaciones = 3; // palabras comunes no son lo retirado"))).toEqual([]);
  });
});
