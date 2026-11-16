import { describe, expect, it } from "vitest";
import { CATALOGO } from "@/core/textos/catalogo";
import { ORACULO_DE_COLUMNAS_DE_DINERO } from "./oraculo-de-columnas";

/**
 * Las palabras de los rótulos de dinero de columnas (lote E, DEC-0016) son exactamente las aprobadas por el dueño («Sí, mismas palabras (Recomendada)», 2026-11-16). El guardián del catálogo
 * (`test/arquitectura/catalogo-de-textos.test.ts`) protege la ESTRUCTURA (usos, fuente, marcadores); esta prueba protege las PALABRAS: el oráculo (`oraculo-de-columnas.ts`) se escribe aparte del código.
 */
const catalogo = CATALOGO as Readonly<Record<string, { porDefecto: string; fuente: unknown }>>;

describe("rótulos de dinero de columnas: las palabras aprobadas", () => {
  it("cada rótulo del oráculo dice EXACTAMENTE lo aprobado (una mutación en el catálogo lo pone en rojo)", () => {
    for (const [clave, palabra] of Object.entries(ORACULO_DE_COLUMNAS_DE_DINERO)) {
      expect(catalogo[clave], `«${clave}» está en el oráculo y no en el catálogo`).toBeDefined();
      expect(catalogo[clave]!.porDefecto, clave).toBe(palabra);
    }
  });

  it("guardián de dimensiones: toda clave del catálogo con la fuente del lote E está en el oráculo, y el oráculo no tiene claves de más", () => {
    const delLote = Object.entries(catalogo)
      .filter(([, e]) => typeof e.fuente === "object" && e.fuente !== null && (e.fuente as { decision?: string }).decision === "DEC-0016")
      .map(([clave]) => clave)
      .sort();
    expect(delLote.length).toBeGreaterThan(0);
    expect(Object.keys(ORACULO_DE_COLUMNAS_DE_DINERO).sort()).toEqual(delLote);
  });
});
