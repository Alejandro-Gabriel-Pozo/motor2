import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * GT-14 (S-26 del plan de endurecimiento de seguridad, tanda T9): **la invalidación del caché de las cartas públicas queda dentro de la empresa**.
 *
 * La página de cada sucursal se cachea (ISR) y toda mutación de carta la invalida. Hasta S-26 la invalidación era `revalidatePath` sobre el patrón
 * `/(carta-publica)/carta-publica/[empresa]/[sucursal]`, que es de TODAS las empresas: una mutación de A (o un administrador que guarda su tema en un bucle) sacaba del
 * caché las cartas de todas las demás, y cada visita anónima a B volvía a pegarle a la base. Ahora la carta de cada empresa lleva la etiqueta de SU empresa
 * (`etiquetaDeCacheDeCartasPublicas`, en `server/carta-publica/sin-sesion.ts`) y `revalidarCartasPublicas(empresaSlug)` invalida esa etiqueta y ninguna otra.
 *
 * Qué fija, por AST y sin base, sobre todo `src/` (fuera de los comentarios):
 *  1. Ningún `revalidatePath` apunta a una ruta de la carta pública: la ruta con `[empresa]` es la invalidación global de antes, y la ruta de UNA empresa no engancha a las
 *     páginas de sus sucursales y NO FALLA (verificado en el artefacto de producción): la carta de la propia empresa quedaba vieja en silencio.
 *  2. Toda llamada a `revalidarCartasPublicas(…)` pasa la empresa, y nadie la pasa «suelta» como callback sin la empresa (`cartaCambio: revalidarCartasPublicas`).
 *  3. `server/actions/carta/revalidar.ts` invalida con `revalidateTag(etiquetaDeCacheDeCartasPublicas(…))`.
 *  4. `server/carta-publica/sin-sesion.ts` cachea la carta con `unstable_cache` y la etiqueta `etiquetaDeCacheDeCartasPublicas(empresa.slug)`: la misma que invalida el punto 3.
 * Que Next de verdad no saque del caché la carta de B lo prueba `test/e2e/carta-publica-cache-por-empresa.spec.ts`.
 *
 * Mutaciones (rojo → revertido editando → verde): volver a `revalidatePath("/(carta-publica)/carta-publica/[empresa]/[sucursal]", "page")` en `revalidar.ts`; una llamada
 * `revalidarCartasPublicas()` sin empresa; sacar la etiqueta de `unstable_cache`; y los casos sintéticos de abajo.
 */
const RAIZ = join(__dirname, "../..");
const REVALIDAR = "src/server/actions/carta/revalidar.ts";
const SIN_SESION = "src/server/carta-publica/sin-sesion.ts";
const ETIQUETA = "etiquetaDeCacheDeCartasPublicas";

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

interface Hallazgos {
  /** El texto del primer argumento de cada `revalidatePath(…)` que nombra la carta pública. */
  revalidatePathDeLaCarta: string[];
  /** Líneas con `revalidarCartasPublicas()` sin argumento. */
  llamadasSinEmpresa: number[];
  /** Líneas donde `revalidarCartasPublicas` se usa como valor (pasada como callback) y no se llama con la empresa. */
  referenciasSueltas: number[];
  /** `revalidateTag(…)` cuyo primer argumento es una llamada a la etiqueta. */
  revalidateTagConEtiqueta: number;
  /** `unstable_cache(…)` cuyo objeto de opciones tiene `tags` con una llamada a la etiqueta. */
  unstableCacheConEtiqueta: number;
}

function hallazgosDe(texto: string, nombre = "x.ts"): Hallazgos {
  const sf = ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true, nombre.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const h: Hallazgos = { revalidatePathDeLaCarta: [], llamadasSinEmpresa: [], referenciasSueltas: [], revalidateTagConEtiqueta: 0, unstableCacheConEtiqueta: 0 };
  const linea = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const esLlamadaAEtiqueta = (n: ts.Node | undefined): boolean => !!n && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === ETIQUETA;
  const visitar = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const nombreLlamado = n.expression.text;
      if (nombreLlamado === "revalidatePath" && n.arguments[0] && /carta-publica/.test(n.arguments[0].getText(sf))) h.revalidatePathDeLaCarta.push(n.arguments[0].getText(sf));
      if (nombreLlamado === "revalidarCartasPublicas" && n.arguments.length === 0) h.llamadasSinEmpresa.push(linea(n));
      if (nombreLlamado === "revalidateTag" && esLlamadaAEtiqueta(n.arguments[0])) h.revalidateTagConEtiqueta++;
      if (nombreLlamado === "unstable_cache") {
        const opciones = n.arguments[2];
        if (opciones && ts.isObjectLiteralExpression(opciones)) {
          const tags = opciones.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "tags");
          if (tags && ts.isArrayLiteralExpression(tags.initializer) && tags.initializer.elements.some(esLlamadaAEtiqueta)) h.unstableCacheConEtiqueta++;
        }
      }
    }
    if (ts.isIdentifier(n) && n.text === "revalidarCartasPublicas") {
      const padre = n.parent;
      const esDeclaracionOImport = ts.isImportSpecifier(padre) || ts.isFunctionDeclaration(padre);
      const esLlamado = ts.isCallExpression(padre) && padre.expression === n;
      if (!esDeclaracionOImport && !esLlamado) h.referenciasSueltas.push(linea(n));
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return h;
}

describe("GT-14 · la invalidación del caché de las cartas públicas queda dentro de la empresa", () => {
  const todos = archivos(join(RAIZ, "src")).map((ruta) => ({ archivo: relative(RAIZ, ruta).split(sep).join("/"), ...hallazgosDe(readFileSync(ruta, "utf8"), ruta) }));
  const de = (archivo: string) => todos.find((t) => t.archivo === archivo);

  it("ningún `revalidatePath` apunta a la carta pública (ni al patrón global con [empresa], ni a la ruta de una empresa, que no engancha y no avisa)", () => {
    const hallados = todos.filter((t) => t.revalidatePathDeLaCarta.length > 0).map((t) => `${t.archivo}: ${t.revalidatePathDeLaCarta.join(", ")}`);
    expect(hallados, "se invalidó la carta pública con revalidatePath: usá revalidarCartasPublicas(ctx.empresaSlug)").toEqual([]);
  });

  it("toda llamada a `revalidarCartasPublicas` pasa la empresa, y nadie la usa como callback sin ella", () => {
    const sinEmpresa = todos.filter((t) => t.llamadasSinEmpresa.length > 0).map((t) => `${t.archivo}:${t.llamadasSinEmpresa.join(",")}`);
    expect(sinEmpresa, "revalidarCartasPublicas() sin empresa").toEqual([]);
    const sueltas = todos.filter((t) => t.referenciasSueltas.length > 0).map((t) => `${t.archivo}:${t.referenciasSueltas.join(",")}`);
    expect(sueltas, "revalidarCartasPublicas pasada como callback: envolvela con la empresa").toEqual([]);
  });

  it("revalidar.ts invalida por la etiqueta de la empresa", () => {
    expect(de(REVALIDAR)?.revalidateTagConEtiqueta, `${REVALIDAR} tiene que llamar revalidateTag(${ETIQUETA}(…))`).toBe(1);
  });

  it("la carta pública se cachea con la misma etiqueta de la empresa (la que invalida revalidar.ts)", () => {
    expect(de(SIN_SESION)?.unstableCacheConEtiqueta, `${SIN_SESION} tiene que cachear con unstable_cache y tags: [${ETIQUETA}(…)]`).toBe(1);
  });

  describe("el propio guardián (casos sintéticos)", () => {
    it("ve un revalidatePath sobre la carta pública, con el patrón global y con la ruta de una empresa, y no ve otro", () => {
      expect(hallazgosDe(`revalidatePath("/(carta-publica)/carta-publica/[empresa]/[sucursal]", "page");`).revalidatePathDeLaCarta).toHaveLength(1);
      expect(hallazgosDe("revalidatePath(`/carta-publica/${slug}`, \"layout\");").revalidatePathDeLaCarta).toHaveLength(1);
      expect(hallazgosDe(`revalidatePath("/stock/consolidado");`).revalidatePathDeLaCarta).toEqual([]);
    });
    it("ve una llamada sin empresa y una referencia suelta, y no ve la llamada con empresa, el import ni la declaración", () => {
      const h = hallazgosDe(`import { revalidarCartasPublicas } from "./revalidar";\nexport function revalidarCartasPublicas(e: string) {}\nrevalidarCartasPublicas(ctx.empresaSlug);\nrevalidarCartasPublicas();\nconst a = { cartaCambio: revalidarCartasPublicas };`);
      expect(h.llamadasSinEmpresa).toEqual([4]);
      expect(h.referenciasSueltas).toEqual([5]);
    });
    it("ve revalidateTag y unstable_cache con la etiqueta, y no ve los que la omiten", () => {
      expect(hallazgosDe(`revalidateTag(${ETIQUETA}(slug), { expire: 0 });`).revalidateTagConEtiqueta).toBe(1);
      expect(hallazgosDe(`revalidateTag("carta", { expire: 0 });`).revalidateTagConEtiqueta).toBe(0);
      expect(hallazgosDe(`unstable_cache(f, ["k"], { tags: [${ETIQUETA}(empresa.slug)], revalidate: 300 });`).unstableCacheConEtiqueta).toBe(1);
      expect(hallazgosDe(`unstable_cache(f, ["k"], { revalidate: 300 });`).unstableCacheConEtiqueta).toBe(0);
      expect(hallazgosDe(`unstable_cache(f, ["k"], { tags: ["global"], revalidate: 300 });`).unstableCacheConEtiqueta).toBe(0);
    });
  });
});
