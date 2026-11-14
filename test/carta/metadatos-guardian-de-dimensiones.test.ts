import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { metadataDeCartaPublica } from "../../src/components/carta-publica/metadatos";
import { CLAVES_DE_OPEN_GRAPH_DECLARADAS, PAGINAS_PUBLICAS_DECLARADAS } from "./oraculo-metadatos";

/**
 * Guardián de dimensiones (regla de combinaciones, 2026-10-28; `docs/diseno-nombre-publico-de-la-empresa-en-la-carta-2026-11-14.md`, nivel 10): el oráculo de los metadatos públicos (`oraculo-metadatos.ts`) declara las
 * páginas públicas y las superficies de Open Graph que recorre. Si aparece una página nueva bajo `(carta-publica)` o una clave nueva de Open Graph sin declararla ahí, este guardián falla: hay que decidir
 * (y escribir en el oráculo) si el nombre público de la empresa la afecta.
 */
const RAIZ = join(__dirname, "../..");
const CARPETA = join(RAIZ, "src/app/(carta-publica)");

function paginas(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return paginas(ruta);
    return nombre === "page.tsx" ? [relative(RAIZ, ruta).split("\\").join("/")] : [];
  });
}

describe("dimensiones de los metadatos públicos", () => {
  it("las páginas públicas que arman metadatos son exactamente las declaradas en el oráculo", () => {
    const conMetadatos = paginas(CARPETA).filter((p) => /export async function generateMetadata/.test(readFileSync(join(RAIZ, p), "utf8")));
    expect(conMetadatos.sort()).toEqual([...PAGINAS_PUBLICAS_DECLARADAS].sort());
  });

  it("las claves de Open Graph que emite la carta son exactamente las declaradas (con todos los datos presentes)", () => {
    const m = metadataDeCartaPublica({ titulo: "T", descripcion: "D", url: "https://x.example/a", origen: "https://x.example", nombreSitio: "Empresa B", imagen: "https://x.example/i.png" });
    expect(Object.keys(m.openGraph ?? {}).sort()).toEqual([...CLAVES_DE_OPEN_GRAPH_DECLARADAS].sort());
  });

  it("sin nombre público no se emite `og:site_name` (F1); con él, sí", () => {
    const base = { titulo: "T", descripcion: "D", url: null, origen: null, imagen: null };
    expect(Object.keys(metadataDeCartaPublica({ ...base, nombreSitio: null }).openGraph ?? {})).not.toContain("siteName");
    expect((metadataDeCartaPublica({ ...base, nombreSitio: "Empresa B" }).openGraph as { siteName?: string }).siteName).toBe("Empresa B");
  });
});
