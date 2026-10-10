import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Frontera de la capa `src/ui/` (marco: «Informe: estructura de carpetas, capas y responsive para motor2», §2 y §4): lo genérico no conoce el negocio.
 *  - `ui/` no importa de `core/`, `server/`, `lib/`, `components/`, `app/` ni de ningún otro lugar de `src/` que no sea `ui/` mismo; tampoco `server-only` ni Prisma.
 *    Los datos entran por props.
 *  - `ui/primitivas` no importa de `ui/componentes` (las capas solo miran hacia abajo).
 *  - Cada carpeta de `ui/` con código expone su API por archivo propio: nadie de afuera importa el interior de otra carpeta de `ui/` de forma que cruce capas (se cubre con la regla anterior).
 * Se comprueba sobre el AST (los imports reales), no sobre el texto. Lo que pide el marco como regla de dependency-cruiser (`.dependency-cruiser.cjs`) queda anotado en
 * PENDIENTE-PARA-LA-UNION.md: ese archivo no se toca en este PR; este test es el cinturón mientras tanto.
 */
const RAIZ = join(__dirname, "../../src");
const UI = join(RAIZ, "ui");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.tsx?$/.test(nombre) ? [ruta] : [];
  });
}

function importsDe(ruta: string): string[] {
  const fuente = ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.Latest, true, ruta.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const especificadores: string[] = [];
  const visitar = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) especificadores.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) especificadores.push(n.arguments[0].text);
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return especificadores;
}

/** El import resuelto a una ruta dentro de `src/` (o null si es un paquete externo). */
function destinoEnSrc(desde: string, especificador: string): string | null {
  if (especificador.startsWith("@/")) return join(RAIZ, especificador.slice(2));
  if (especificador.startsWith(".")) return join(desde, "..", especificador);
  return null;
}

const ARCHIVOS_UI = archivos(UI);
const PAQUETES_PROHIBIDOS = [/^server-only$/, /^@prisma\//, /^@sentry\//, /^next-auth/, /^@auth\//];

describe("src/ui no conoce el negocio ni la aplicación", () => {
  it("hay archivos para comprobar (si no, el test pasaría en vacío)", () => {
    expect(ARCHIVOS_UI.length).toBeGreaterThanOrEqual(3);
  });

  it.each(ARCHIVOS_UI.map((a) => [relative(RAIZ, a).split(sep).join("/"), a] as const))("%s solo importa de paquetes de presentación o de src/ui", (_nombre, ruta) => {
    const fuera: string[] = [];
    for (const esp of importsDe(ruta)) {
      if (PAQUETES_PROHIBIDOS.some((re) => re.test(esp))) {
        fuera.push(esp);
        continue;
      }
      const destino = destinoEnSrc(ruta, esp);
      if (destino !== null && !(destino === UI || destino.startsWith(UI + sep))) fuera.push(esp);
    }
    expect(fuera, "imports que sacan a ui/ de su capa").toEqual([]);
  });

  it("las primitivas no importan componentes compuestos", () => {
    const primitivas = ARCHIVOS_UI.filter((a) => a.startsWith(join(UI, "primitivas") + sep));
    const hacia: string[] = [];
    for (const ruta of primitivas) {
      for (const esp of importsDe(ruta)) {
        const destino = destinoEnSrc(ruta, esp);
        if (destino !== null && destino.startsWith(join(UI, "componentes"))) hacia.push(`${relative(RAIZ, ruta)} → ${esp}`);
      }
    }
    expect(hacia).toEqual([]);
  });
});
