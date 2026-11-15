import { describe, expect, it } from "vitest";
import { colorDeTextoLegible } from "../../src/core/carta/color-css";
import { resolverEstiloCarta } from "../../src/core/carta/estilo";

/**
 * Defecto 2 del ensayo general (2026-11-13): el color de marca de una sucursal (#797d62) usado como texto sobre su fondo (#181818) daba 4,16:1, menos que el 4,5:1 de WCAG 1.4.3.
 * `colorDeTextoLegible` lo acerca a la tinta del tema lo justo; lo que ya se lee no cambia. El contraste de estas pruebas se calcula acá, aparte del código (un oráculo propio, solo para hex).
 */
function contrasteHex(a: string, b: string): number {
  const luz = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [luz(a), luz(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const aHex = (rgb: string) => "#" + (rgb.match(/\d+/g) ?? []).map((n) => Number(n).toString(16).padStart(2, "0")).join("");

const TINTA_CLARA = "oklch(0.96 0.005 80)";
const TINTA_OSCURA = "oklch(0.18 0.02 40)";

describe("colorDeTextoLegible", () => {
  it("el caso real: #797d62 sobre #181818 (4,16:1) se aclara hasta llegar a 4,5:1, conservando el tono", () => {
    expect(contrasteHex("#797d62", "#181818")).toBeLessThan(4.5);
    const resultado = colorDeTextoLegible("#797d62", "#181818", TINTA_CLARA);
    expect(resultado).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(contrasteHex(aHex(resultado), "#181818")).toBeGreaterThanOrEqual(4.5);
    const [r, g, b] = (resultado.match(/\d+/g) ?? []).map(Number);
    expect(g! > b! && r! > b!).toBe(true); // sigue siendo un verde oliva, no un gris
  });

  it("un color que ya llega a 4,5:1 se devuelve idéntico (la carta no cambia)", () => {
    expect(colorDeTextoLegible("#b9b5f0", "#181818", TINTA_CLARA)).toBe("#b9b5f0");
    expect(colorDeTextoLegible("#92400e", null, null)).toBe("#92400e"); // el ámbar de la carta sin tema, sobre blanco: ~5,1:1
    expect(colorDeTextoLegible("#92400e", "", "")).toBe("#92400e");
  });

  it("sobre un fondo claro oscurece en vez de aclarar", () => {
    expect(contrasteHex("#b08968", "#ffffff")).toBeLessThan(4.5);
    const resultado = colorDeTextoLegible("#b08968", "#ffffff", TINTA_OSCURA);
    expect(contrasteHex(aHex(resultado), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("lo que no se puede medir se devuelve sin tocar (nombre CSS, var(), hex de 8 dígitos, fondo ilegible)", () => {
    expect(colorDeTextoLegible("goldenrod", "#181818", TINTA_CLARA)).toBe("goldenrod");
    expect(colorDeTextoLegible("var(--x)", "#181818", TINTA_CLARA)).toBe("var(--x)");
    expect(colorDeTextoLegible("#797d62cc", "#181818", TINTA_CLARA)).toBe("#797d62cc");
    expect(colorDeTextoLegible("#797d62", "darkslategray", null)).toBe("#797d62");
  });

  it("en toda la grilla de marcas × fondos legibles, el resultado llega a 4,5:1 (exhaustivo)", () => {
    const canales = [0, 64, 128, 192, 255];
    const hexes = canales.flatMap((r) => canales.flatMap((g) => canales.map((b) => "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join(""))));
    for (const fondo of ["#181818", "#ffffff", "#2a1f3d", "#f5efe0", "#000000"]) {
      const tinta = resolverEstiloCarta({ color_fondo_dia: fondo }).tintaBase;
      for (const marca of hexes) {
        const resultado = colorDeTextoLegible(marca, fondo, tinta);
        const hex = resultado.startsWith("#") ? resultado : aHex(resultado);
        expect(contrasteHex(hex, fondo), `${marca} sobre ${fondo} → ${resultado}`).toBeGreaterThanOrEqual(4.5);
        if (contrasteHex(marca, fondo) >= 4.5) expect(resultado).toBe(marca);
      }
    }
  });
});

describe("resolverEstiloCarta: --carta-primary-texto", () => {
  it("con la marca tenue de la sucursal sobre fondo oscuro se define y llega a 4,5:1", () => {
    const e = resolverEstiloCarta({ color_fondo_dia: "#181818", color_marca: "#797d62" });
    const texto = e.variablesCss["--carta-primary-texto"];
    expect(texto).toBeDefined();
    expect(contrasteHex(aHex(texto!), "#181818")).toBeGreaterThanOrEqual(4.5);
  });

  it("no se define cuando la marca ya se lee, cuando no hay marca o cuando el fondo no se puede leer (todo igual que antes)", () => {
    expect(resolverEstiloCarta({ color_fondo_dia: "#181818", color_marca: "#b9b5f0" }).variablesCss).not.toHaveProperty("--carta-primary-texto");
    expect(resolverEstiloCarta({ color_marca: "#92400e" }).variablesCss).not.toHaveProperty("--carta-primary-texto");
    expect(resolverEstiloCarta({}).variablesCss).not.toHaveProperty("--carta-primary-texto");
    expect(resolverEstiloCarta({ color_fondo_dia: "darkslategray", color_marca: "#797d62" }).variablesCss).not.toHaveProperty("--carta-primary-texto");
  });
});
