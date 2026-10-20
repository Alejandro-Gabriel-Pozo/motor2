import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardián de arquitectura (GO-3b, ADR-032, frente B; molde de `lectores-de-receta.test.ts` y `lectores-de-version-de-opcion.test.ts`), en DOS capas:
 *
 * 1. EMBUDO: elegir «la receta propia VIGENTE» de una combinación (la versión de `numero` mayor) pasa SOLO por `server/lecturas/catalogo/recetas-de-combinacion.ts` (con la regla pura
 *    `versionVigente`). Ningún otro archivo de `src/` puede leer `RecetaDeCombinacionVersion` o sus ingredientes por su cuenta (`recetaDeCombinacionVersion.find*`/`groupBy`/`count`/`aggregate`,
 *    `recetaDeCombinacionIngrediente.find*`), pedir las versiones anidadas de una combinación (`recetas: …`) ni nombrarlas en SQL crudo: una sola forma de la regla.
 * 2. CLASIFICACIÓN: todo archivo que lee la versión CONGELADA en la foto de una línea (`recetaDeCombinacionVersion: …` anidado desde `CombinacionEnLinea`) tiene que estar en la lista de abajo, con
 *    motivo: esos leen la versión que se VENDIÓ (la congelada al agregar el ítem), nunca la vigente.
 *
 * Los comentarios se descartan sobre el archivo entero y los patrones se buscan también a través de saltos de línea. Verificado en las dos direcciones.
 *
 * Fase 3 de la ola «precio y carta», paso 3.3: la venta ya no lee la receta VIGENTE de una combinación (se retiró GO-3a de la venta) y el embudo se borró: la capa 1 pasa a exigir que NADIE la lea.
 * La capa 2 (el cierre que lee la versión congelada) se va en el paso 3.4, junto con este guardián.
 */
const SRC = join(__dirname, "../../src");

const LECTORES_DE_LA_VERSION_CONGELADA: readonly { ruta: string; motivo: string }[] = [
  {
    ruta: "server/persistencia/pos/cargar-cuenta-para-cerrar.ts",
    motivo: "GO-3b I3: el cierre de la cuenta lee la versión CONGELADA en `CombinacionEnLinea` (por su id, nunca la vigente) para consumir la receta propia de la combinación vendida.",
  },
];
const RUTAS_CLASIFICADAS = new Set(LECTORES_DE_LA_VERSION_CONGELADA.map((a) => a.ruta));

function archivosFuente(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivosFuente(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

/** El archivo sin comentarios (`//` y `/* *\/`), conservando los saltos de línea y lo que está dentro de un string. */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, (bloque) => bloque.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const PATRONES_DEL_EMBUDO: readonly RegExp[] = [
  /\brecetaDeCombinacionVersion\s*\.\s*(find\w*|groupBy|count|aggregate)/,
  /\brecetaDeCombinacionIngrediente\s*\.\s*(find\w*|groupBy|count|aggregate)/,
  /\brecetas\s*:\s*\{/,
  /\b(FROM|JOIN)\s+"RecetaDeCombinacion(Version|Ingrediente)"/i,
];

function eligeLaRecetaPorSuCuenta(fuente: string): boolean {
  const limpia = sinComentarios(fuente);
  return PATRONES_DEL_EMBUDO.some((re) => re.test(limpia));
}

const LECTURA_CONGELADA: readonly RegExp[] = [/\brecetaDeCombinacionVersion\s*:\s*\{/];

function necesitaClasificacion(fuente: string): boolean {
  const limpia = sinComentarios(fuente);
  return LECTURA_CONGELADA.some((re) => re.test(limpia));
}

describe("lectores de la receta propia de una combinación: el embudo es el único que elige la vigente (GO-3b)", () => {
  const fuentes = new Map(archivosFuente(SRC).map((ruta) => [relative(SRC, ruta).split(sep).join("/"), readFileSync(ruta, "utf8")]));

  it("encuentra archivos de src/", () => {
    expect(fuentes.size).toBeGreaterThan(50);
  });

  it("ningún archivo lee o elige versiones de la receta de una combinación (el embudo se retiró con GO-3a)", () => {
    const sueltos = [...fuentes].filter(([, fuente]) => eligeLaRecetaPorSuCuenta(fuente)).map(([nombre]) => nombre);
    expect(sueltos, `Estos archivos eligen o leen la receta de una combinación (retirada en la Fase 3):\n${sueltos.join("\n")}`).toEqual([]);
  });

  it("todo lector de la versión congelada está declarado, y ninguno declarado dejó de serlo", () => {
    const encontrados = new Set([...fuentes].filter(([, fuente]) => necesitaClasificacion(fuente)).map(([nombre]) => nombre));
    expect([...encontrados].filter((n) => !RUTAS_CLASIFICADAS.has(n)), "leen la receta congelada de una combinación y no están declarados").toEqual([]);
    expect([...RUTAS_CLASIFICADAS].filter((n) => !encontrados.has(n)), "declarados que ya no la leen: sacalos de la lista").toEqual([]);
  });

  describe("el detector (con datos sintéticos)", () => {
    it("ve una lectura directa, unas versiones anidadas y el SQL crudo; no un comentario ni una escritura", () => {
      expect(eligeLaRecetaPorSuCuenta("await tx.recetaDeCombinacionVersion.findFirst({})")).toBe(true);
      expect(eligeLaRecetaPorSuCuenta("await tx.recetaDeCombinacionIngrediente.findMany({})")).toBe(true);
      expect(eligeLaRecetaPorSuCuenta("combinacion: { select: { recetas:\n { take: 1 } } }")).toBe(true);
      expect(eligeLaRecetaPorSuCuenta('tx.$queryRaw`SELECT * FROM "RecetaDeCombinacionVersion"`')).toBe(true);
      expect(eligeLaRecetaPorSuCuenta("// tx.recetaDeCombinacionVersion.findMany({})")).toBe(false);
      expect(eligeLaRecetaPorSuCuenta("await tx.recetaDeCombinacionVersion.create({})")).toBe(false);
      expect(necesitaClasificacion("combinacionEnLinea: { select: { recetaDeCombinacionVersion: { select: { ingredientes: true } } } }")).toBe(true);
      expect(necesitaClasificacion("recetaDeCombinacionVersionId: true")).toBe(false);
    });
  });
});
