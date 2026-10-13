import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { alcanzables, RAIZ, relativa } from "./guardas/lecturas-de-la-carta-publica";
import { CACHE_PUBLICO_DE_LA_CARTA } from "@/core/seguridad/cabeceras";

/**
 * La parte pública de la carta se sirve desde la CDN (portal: `Cache-Control` público de 60 s; carta de una sucursal: ISR con `revalidate = 60`). Eso solo es seguro si la respuesta NO depende de quién la pide:
 * si una página pública leyera las cookies o los encabezados del pedido, la CDN le serviría a un visitante lo que se armó para otro. Este guardián fija, por AST y sin base, tres cosas sobre TODO el código alcanzable
 * desde las páginas y rutas de `(carta-publica)` (sus componentes y `server/carta-publica/sin-sesion.ts`):
 *  1. ninguno importa `next/headers` ni llama a `cookies()`, `headers()`, `draftMode()`, `connection()` ni `unstable_noStore()` (lo que vuelve dinámica a una página o la hace variar por pedido);
 *  2. la carta de una sucursal es ISR de 60 s (`revalidate = 60` + `generateStaticParams`, sin `dynamic`), y de las páginas públicas solo el portal es `force-dynamic` (a propósito, ver su nota);
 *  3. la cabecera pública de 60 s está puesta para el portal en `next.config.ts` (la ruta técnica y el host de la carta) y `expireTime` acota el `stale-while-revalidate` de las páginas ISR.
 * Que Next de verdad emita esos encabezados y que el panel NO los lleve lo prueba `test/e2e/carta-publica-cache.spec.ts`.
 *
 * Mutaciones (rojo → revertido editando → verde): un `cookies()` en un componente de la carta; `export const revalidate = 300`; sacar `generateStaticParams`; sacar la regla del portal de `next.config.ts`; y los casos sintéticos de abajo.
 */
const PROHIBIDAS = new Set(["cookies", "headers", "draftMode", "connection", "unstable_noStore", "noStore"]);

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
  });
}

/** Lo que de un archivo lo vuelve dependiente del pedido: importar `next/headers` o llamar a una API de pedido. */
function usosDeApisDePedido(texto: string, nombre = "x.ts"): string[] {
  const sf = ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true, nombre.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const usos: string[] = [];
  const visitar = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === "next/headers") usos.push("import next/headers");
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && PROHIBIDAS.has(n.expression.text)) usos.push(`${n.expression.text}()`);
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return usos;
}

/** Las exportaciones de configuración de segmento que fijan el caché (`revalidate`, `dynamic`) con su valor literal, y si exporta `generateStaticParams`. */
function configDeCache(texto: string): { revalidate?: string; dynamic?: string; generateStaticParams: boolean } {
  const sf = ts.createSourceFile("pagina.tsx", texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const r: { revalidate?: string; dynamic?: string; generateStaticParams: boolean } = { generateStaticParams: false };
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st) && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (d.name.text === "revalidate" || d.name.text === "dynamic")) r[d.name.text] = d.initializer.getText(sf).replace(/^"|"$/g, "");
      }
    }
    if (ts.isFunctionDeclaration(st) && st.name?.text === "generateStaticParams" && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) r.generateStaticParams = true;
  }
  return r;
}

const ENTRADAS = [...archivos(join(RAIZ, "src/app/(carta-publica)")), ...archivos(join(RAIZ, "src/components/carta-publica")), join(RAIZ, "src/server/carta-publica/sin-sesion.ts"), join(RAIZ, "src/app/layout.tsx")];
const alcance = alcanzables(ENTRADAS);
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

describe("la parte pública de la carta es cacheable: no depende de quién la pide", () => {
  it("el análisis llega a las páginas, los componentes y la lectura (que el guardián no pase en vacío)", () => {
    const rel = alcance.map(relativa);
    expect(rel).toEqual(expect.arrayContaining(["src/app/(carta-publica)/carta-publica/[empresa]/page.tsx", "src/app/(carta-publica)/carta-publica/[empresa]/[sucursal]/page.tsx", "src/server/carta-publica/sin-sesion.ts", "src/components/carta-publica/carta-vista.tsx"]));
    expect(rel.length).toBeGreaterThan(30);
  });

  it("nada de lo alcanzable desde (carta-publica) lee cookies, encabezados ni ninguna API de pedido", () => {
    const hallazgos = alcance.flatMap((ruta) => usosDeApisDePedido(readFileSync(ruta, "utf8"), ruta).map((u) => `${relativa(ruta)}: ${u}`));
    expect(hallazgos, "una página pública que lee el pedido deja de ser cacheable: la CDN serviría a unos lo que se armó para otros").toEqual([]);
  });

  it("la carta de una sucursal es ISR de 60 s: revalidate = 60, generateStaticParams y sin `dynamic`", () => {
    const c = configDeCache(leer("src/app/(carta-publica)/carta-publica/[empresa]/[sucursal]/page.tsx"));
    expect(c).toEqual({ revalidate: "60", generateStaticParams: true });
  });

  it("el portal es dinámico para Next (a propósito) y ninguna otra página pública fuerza lo dinámico ni fija otro caché", () => {
    expect(configDeCache(leer("src/app/(carta-publica)/carta-publica/[empresa]/page.tsx"))).toEqual({ dynamic: "force-dynamic", generateStaticParams: false });
    for (const rel of ["src/app/(carta-publica)/carta-publica/[empresa]/robots.txt/route.ts", "src/app/(carta-publica)/carta-publica/[empresa]/sitemap.xml/route.ts"]) {
      expect(configDeCache(leer(rel)), rel).toEqual({ generateStaticParams: false });
    }
  });

  it("next.config.ts pone el caché público de 60 s al portal (ruta técnica y host de la carta) y acota el stale-while-revalidate de las páginas ISR", () => {
    expect(CACHE_PUBLICO_DE_LA_CARTA).toEqual({ key: "Cache-Control", value: "public, s-maxage=60, stale-while-revalidate=300" });
    const config = leer("next.config.ts");
    expect(config).toContain('{ source: "/carta-publica/:empresa", headers: [CACHE_PUBLICO_DE_LA_CARTA] }');
    expect(config).toMatch(/\{ source: "\/", has: \[[^\]]*patronHostZonaCarta\(dominioBaseCarta\)[^\]]*\], headers: \[CACHE_PUBLICO_DE_LA_CARTA\] \}/);
    // 360 - 60 = 300 s de stale-while-revalidate (sin esto es de un año).
    expect(config).toMatch(/expireTime:\s*360\b/);
  });

  it("las respuestas 200 de robots.txt y sitemap.xml llevan el caché público y los 404 no", () => {
    for (const rel of ["src/app/(carta-publica)/carta-publica/[empresa]/robots.txt/route.ts", "src/app/(carta-publica)/carta-publica/[empresa]/sitemap.xml/route.ts"]) {
      const texto = leer(rel);
      expect(texto, rel).toContain("[CACHE_PUBLICO_DE_LA_CARTA.key]: CACHE_PUBLICO_DE_LA_CARTA.value");
      expect((texto.match(/CACHE_PUBLICO_DE_LA_CARTA\.key/g) ?? []).length, `${rel}: solo la respuesta 200`).toBe(1);
    }
  });

  describe("el propio guardián (casos sintéticos)", () => {
    it("ve el import de next/headers y cada API de pedido, y no ve un archivo limpio", () => {
      expect(usosDeApisDePedido(`import { cookies } from "next/headers";\nexport async function f() { return (await cookies()).get("a"); }`)).toEqual(["import next/headers", "cookies()"]);
      expect(usosDeApisDePedido(`const h = await headers(); draftMode(); connection(); unstable_noStore();`)).toEqual(["headers()", "draftMode()", "connection()", "unstable_noStore()"]);
      expect(usosDeApisDePedido(`import { notFound } from "next/navigation";\nexport const x = () => notFound();`)).toEqual([]);
    });
    it("lee revalidate, dynamic y generateStaticParams exportados", () => {
      expect(configDeCache(`export const revalidate = 300;\nexport function generateStaticParams() { return []; }`)).toEqual({ revalidate: "300", generateStaticParams: true });
      expect(configDeCache(`export const dynamic = "force-dynamic";`)).toEqual({ dynamic: "force-dynamic", generateStaticParams: false });
      expect(configDeCache(`const revalidate = 5;`)).toEqual({ generateStaticParams: false });
    });
  });
});
