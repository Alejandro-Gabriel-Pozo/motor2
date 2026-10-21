import { describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO, leer, sinComentarios } from "./cercos/trinquete";
import { leerReglas, reglaDelAncla } from "./contratos/adaptadores/css";
import { TOKENS_VISUALES } from "./contratos/contratos/tokens-visuales";

/**
 * Contraste de los tokens del sistema visual (Fase 6, paso 6.1). NO es un contrato (el contrato `tokens-visuales` vigila QUÉ nombres se usan y dónde se definen): acá se mide que los
 * VALORES de los tokens de `@theme static` (`src/app/globals.css`) cumplan WCAG 2.1 para los pares que el sistema usa. Lee los valores del propio ancla, así que un token que cambia de
 * color y deja de llegar hace fallar la prueba con el par, el valor y el piso.
 *  - Texto (1.4.3, AA): 4,5:1.
 *  - Color de un gráfico o de una barra de estado (1.4.11): 3:1. `aviso` sobre papel da ~3,11:1: es el piso, no hay margen para aclararlo.
 * Un par nuevo (un token nuevo que se usa como texto o fondo) se agrega acá junto con el token. El calculador es propio y mínimo: el de `src/core/carta/color-css.ts` es una copia literal
 * de otro repo y no se exporta.
 */
const BLANCO = "#FFFFFF";
const TEXTO = 4.5;
const GRAFICO = 3;
const RE_HEX = /^#[0-9A-Fa-f]{6}$/;

/** Los valores de las propiedades `--color-*` de la regla ancla de la fuente del contrato. */
function tokensDelAncla(): Map<string, string> {
  const ruta = TOKENS_VISUALES.fuente.archivo;
  const regla = reglaDelAncla(leerReglas(sinComentarios(leer(RAIZ_DEL_REPO, ruta), ruta)), TOKENS_VISUALES.fuente.ancla);
  if (regla === null) throw new Error(`no se encontró el ancla «${TOKENS_VISUALES.fuente.ancla}» en ${ruta}`);
  return new Map(regla.declaraciones.filter((d) => d.propiedad.startsWith("--color-")).map((d) => [d.propiedad, d.valor]));
}

const canalLineal = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminancia = (hex: string): number => {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * canalLineal((n >> 16) & 255) + 0.7152 * canalLineal((n >> 8) & 255) + 0.0722 * canalLineal(n & 255);
};
/** El contraste WCAG entre dos colores `#RRGGBB`, de 1 a 21. */
function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Un valor: el nombre de un token (`tinta`) o un color literal (`#FFFFFF`). */
const resolver = (tokens: Map<string, string>, v: string): string => {
  if (v.startsWith("#")) return v.toUpperCase();
  const valor = tokens.get(`--color-${v}`);
  if (valor === undefined) throw new Error(`el par usa el token «${v}» y @theme static no define --color-${v}`);
  return valor.toUpperCase();
};

/** [color de primer plano, fondo]. */
const TEXTO_SOBRE_FONDO: readonly (readonly [string, string])[] = [
  ["tinta", "papel"],
  ["tinta", BLANCO],
  ["tinta-suave", "papel"],
  ["tinta-suave", BLANCO],
  ["tinta-tenue", "papel"],
  ["tinta-tenue", BLANCO],
  [BLANCO, "marca"],
  [BLANCO, "tinta"],
  ["ok-tinta", "ok-tinte"],
  ["aviso-tinta", "aviso-tinte"],
  ["error", "error-tinte"],
];
const GRAFICOS_SOBRE_PAPEL: readonly (readonly [string, string])[] = [
  ["ok", "papel"],
  ["aviso", "papel"],
  ["error", "papel"],
];

describe("tokens del sistema visual: contraste de los pares (WCAG 2.1)", () => {
  const tokens = tokensDelAncla();

  it("el calculador da los valores conocidos (negro sobre blanco 21:1, el gris viejo del salón 2,48:1)", () => {
    expect(contraste("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contraste("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    // `--ink-faint` valía #A8A49C (2,48:1 sobre blanco): con ese valor el par de texto no llega.
    expect(contraste("#A8A49C", BLANCO)).toBeCloseTo(2.48, 1);
    expect(contraste("#A8A49C", "#FAFAF8")).toBeLessThan(TEXTO);
  });

  it("el ancla define tokens, y cada valor es un hex de 6 dígitos", () => {
    expect(tokens.size).toBeGreaterThan(0);
    for (const [nombre, valor] of tokens) expect(RE_HEX.test(valor), `${nombre}: «${valor}» no es #RRGGBB`).toBe(true);
  });

  it.each(TEXTO_SOBRE_FONDO)("texto %s sobre %s: 4,5:1 como mínimo", (texto, fondo) => {
    const a = resolver(tokens, texto);
    const b = resolver(tokens, fondo);
    expect(RE_HEX.test(a) && RE_HEX.test(b), `${texto} ${a} / ${fondo} ${b}`).toBe(true);
    expect(contraste(a, b), `${texto} (${a}) sobre ${fondo} (${b})`).toBeGreaterThanOrEqual(TEXTO);
  });

  it.each(GRAFICOS_SOBRE_PAPEL)("gráfico %s sobre %s: 3:1 como mínimo", (color, fondo) => {
    const a = resolver(tokens, color);
    const b = resolver(tokens, fondo);
    expect(RE_HEX.test(a) && RE_HEX.test(b), `${color} ${a} / ${fondo} ${b}`).toBe(true);
    expect(contraste(a, b), `${color} (${a}) sobre ${fondo} (${b})`).toBeGreaterThanOrEqual(GRAFICO);
  });

  it("un par con un token que el ancla no define falla con el nombre (no pasa en silencio)", () => {
    expect(() => resolver(tokens, "tinta-inventada")).toThrow(/no define --color-tinta-inventada/);
  });
});
