import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { unicosDeUrl } from "../../src/core/datos/parametros-de-url";

/**
 * Los `searchParams` de una página son `string | string[] | undefined` por clave (`?desde=a&desde=b` llega como arreglo). Declararlos como
 * `Promise<{ desde?: string }>` miente: el código opera sobre un arreglo creyendo que es texto. Toda página los declara con
 * `ParametrosDeUrl<"desde" | …>` (o con `string | string[]` explícito) y pasa por `unicosDeUrl`. Falla cerrado: una página nueva con
 * `searchParams: Promise<{ x?: string }>` rompe esta prueba.
 */
const RAIZ = join(__dirname, "../../src/app");

function paginas(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) paginas(ruta, salida);
    else if (e.name === "page.tsx") salida.push(ruta);
  }
  return salida;
}

/** `archivo:línea` de cada miembro `searchParams: Promise<{ clave?: string }>` tipado como texto a secas. */
export function searchParamsMentirosos(rel: string, codigo: string): string[] {
  const fuente = ts.createSourceFile(rel, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const malos: string[] = [];
  const visitar = (n: ts.Node) => {
    if (ts.isPropertySignature(n) && n.name.getText(fuente) === "searchParams" && n.type && ts.isTypeReferenceNode(n.type)) {
      const literal = n.type.typeArguments?.[0];
      if (literal && ts.isTypeLiteralNode(literal) && literal.members.some((m) => ts.isPropertySignature(m) && m.type?.kind === ts.SyntaxKind.StringKeyword)) {
        malos.push(`${rel}:${fuente.getLineAndCharacterOfPosition(n.getStart(fuente)).line + 1}`);
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(fuente);
  return malos;
}

describe("los searchParams de las páginas no se declaran como texto a secas", () => {
  it("el analizador distingue el tipo mentiroso del honesto (sanidad: no pasa en vacío)", () => {
    expect(searchParamsMentirosos("p.tsx", "export default function P({ searchParams }: { searchParams: Promise<{ q?: string }> }) {}")).toEqual(["p.tsx:1"]);
    expect(searchParamsMentirosos("p.tsx", "export default function P({ searchParams }: { searchParams: Promise<ParametrosDeUrl<\"q\">> }) {}")).toEqual([]);
    expect(searchParamsMentirosos("p.tsx", "export default function P({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {}")).toEqual([]);
  });

  it("ninguna página de src/app lo hace", () => {
    const todas = paginas(RAIZ);
    expect(todas.length).toBeGreaterThan(30);
    const malos = todas.flatMap((p) => searchParamsMentirosos(relative(RAIZ, p), readFileSync(p, "utf8")));
    expect(malos, "tipá los searchParams con ParametrosDeUrl<\"clave\" | …> (@/core/datos/parametros-de-url) y pasalos por unicosDeUrl").toEqual([]);
  });
});

describe("unicosDeUrl", () => {
  it("se queda con el primer valor de una clave repetida y deja las simples y las ausentes como están", () => {
    expect(unicosDeUrl({ desde: ["2026-01-01", "2026-02-01"], hasta: "2026-03-01", rango: undefined })).toEqual({ desde: "2026-01-01", hasta: "2026-03-01" });
  });

  it("un arreglo vacío no deja una clave con basura", () => {
    expect(unicosDeUrl({ q: [] })).toEqual({});
  });
});
