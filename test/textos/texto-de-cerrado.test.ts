import { describe, expect, it, vi } from "vitest";

/**
 * Fallo cerrado de `textoDe` con un catálogo de juguete (se reemplaza el módulo del catálogo): el artículo indefinido `{x:un}` sobre un marcador que NO es entidad no se escribe (mensaje genérico), y un hueco
 * sin valor tampoco. Protege las guardas de `armar` que el catálogo real no ejerce (la regla C5 del guardián impide declararlas, esto prueba que en ejecución caen cerradas igual).
 */
vi.mock("@/core/textos/catalogo", () => ({
  CATALOGO: {
    "aviso.articulo_en_texto": { porDefecto: "Hola {nombre:un}", marcadores: { nombre: "texto" } },
    "aviso.texto_solo": { porDefecto: "Hola {nombre}", marcadores: { nombre: "texto" } },
  },
}));

describe("textoDe: las guardas de ejecución que el catálogo real no ejerce", () => {
  it("`{nombre:un}` sobre un marcador de tipo texto cae al mensaje genérico (no se escribe el valor)", async () => {
    const { textoDe, MENSAJE_GENERICO } = await import("@/core/textos/texto-de");
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const leer = textoDe as unknown as (clave: string, valores?: Record<string, unknown>) => string;
    expect(leer("aviso.articulo_en_texto", { nombre: "Ana" })).toBe(MENSAJE_GENERICO);
    expect(leer("aviso.texto_solo", { nombre: "Ana" })).toBe("Hola Ana");
    espia.mockRestore();
  });
});
