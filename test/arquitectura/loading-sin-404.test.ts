import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regla de arquitectura (pendiente #44, feedback al hacer click): un `loading.tsx` envuelve las páginas de su segmento en un Suspense, y con eso un
 * `notFound()` (o un `redirect()`) posterior a un `await` ya no puede cambiar el código de estado: el 404 pasa a 200 + noindex (rompería
 * `catalogo-ficha-producto` / `catalogo-ficha-proveedor`). Por eso:
 *  - ninguna `page.tsx` ni `layout.tsx` por debajo de un `loading.tsx` llama a `notFound(`, `redirect(` ni `permanentRedirect(`;
 *  - ningún `loading.tsx` lleva `role="status"` ni `aria-live` (los specs buscan `getByRole("status")` en toda la página).
 */
const RAIZ = join(__dirname, "../../src/app");

const NOT_FOUND_O_REDIRECT = /\b(notFound|redirect|permanentRedirect)\s*\(/;
const ANUNCIO = /role\s*=\s*["']status["']|aria-live/;

function esComentario(linea: string): boolean {
  const t = linea.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("{/*");
}

function sinComentarios(fuente: string): string[] {
  return fuente
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((l) => !esComentario(l))
    .map((l) => l.replace(/\/\/.*$/, ""));
}

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

const todos = archivos(RAIZ);
const loadings = todos.filter((r) => /[\\/]loading\.tsx$/.test(r));

describe("loading.tsx no cambia el 404 ni los role=status", () => {
  it("hay al menos un loading.tsx (si no, este test no está probando nada)", () => {
    expect(loadings.length).toBeGreaterThan(0);
  });

  for (const loading of loadings) {
    const dirSegmento = join(loading, "..");
    const nombre = relative(RAIZ, loading);

    it(`${nombre}: ninguna page/layout por debajo llama a notFound/redirect`, () => {
      const problemas = todos
        .filter((r) => r.startsWith(dirSegmento) && /[\\/](page|layout)\.tsx$/.test(r))
        .flatMap((r) =>
          sinComentarios(readFileSync(r, "utf8"))
            .filter((l) => NOT_FOUND_O_REDIRECT.test(l))
            .map((l) => `${relative(RAIZ, r)}: ${l.trim()}`),
        );
      expect(problemas, `notFound/redirect bajo un loading.tsx:\n${problemas.join("\n")}`).toEqual([]);
    });

    it(`${nombre}: no lleva role="status" ni aria-live`, () => {
      const problemas = sinComentarios(readFileSync(loading, "utf8")).filter((l) => ANUNCIO.test(l));
      expect(problemas, `role=status/aria-live en un loading.tsx:\n${problemas.join("\n")}`).toEqual([]);
    });
  }
});
