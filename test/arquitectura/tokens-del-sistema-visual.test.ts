import { describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO, leer, sinComentarios } from "./cercos/trinquete";
import { leerReglas, reglaDelAncla, type ReglaCss } from "./contratos/adaptadores/css";
import { TOKENS_VISUALES } from "./contratos/contratos/tokens-visuales";

/**
 * Contraste de los tokens del sistema visual (Fase 6, paso 6.1). NO es un contrato (el contrato `tokens-visuales` vigila QUÉ nombres se usan y dónde se definen): acá se mide que los
 * VALORES de los tokens de `@theme static` (`src/app/globals.css`) cumplan WCAG 2.1 para los pares que el sistema usa. Lee los valores del propio ancla, así que un token que cambia de
 * color y deja de llegar hace fallar la prueba con el par, el valor y el piso.
 *  - Texto (1.4.3, AA): 4,5:1.
 *  - Color de un gráfico, de una barra de estado o del contorno del foco de teclado (1.4.11): 3:1. `aviso` sobre papel da ~3,11:1: es el piso, no hay margen para aclararlo.
 * El bloque «fondo y foco» (6.5) mide lo que no es un valor: que el foco único esté en `@layer base` (para que las utilidades `focus-visible:` y las reglas sin capa le ganen) y excluya la
 * carta pública, y que solo la administración (`main[data-panel]`) vaya sobre papel.
 * Un par nuevo (un token nuevo que se usa como texto o fondo) se agrega acá junto con el token. El calculador es propio y mínimo: el de `src/core/carta/color-css.ts` es una copia literal
 * de otro repo y no se exporta.
 */
const BLANCO = "#FFFFFF";
const TEXTO = 4.5;
const GRAFICO = 3;
const RE_HEX = /^#[0-9A-Fa-f]{6}$/;
/** Un token que es un alias de otro (`--color-foco: var(--color-tinta)`). */
const RE_ALIAS = /^var\((--color-[\w-]+)\)$/;

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

/** Un valor: el nombre de un token (`tinta`) o un color literal (`#FFFFFF`). Un token que es un alias de otro (`var(--color-tinta)`) se sigue hasta el color. */
const resolver = (tokens: Map<string, string>, v: string): string => {
  if (v.startsWith("#")) return v.toUpperCase();
  const valor = tokens.get(`--color-${v}`);
  if (valor === undefined) throw new Error(`el par usa el token «${v}» y @theme static no define --color-${v}`);
  const alias = RE_ALIAS.exec(valor);
  return alias === null ? valor.toUpperCase() : resolver(tokens, alias[1].slice("--color-".length));
};

/** [color de primer plano, fondo]. */
const TEXTO_SOBRE_FONDO: readonly (readonly [string, string])[] = [
  ["tinta", "papel"],
  ["tinta", "superficie"],
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
  // 6.5: el contorno del foco de teclado, contra el papel de la administración y contra las tarjetas blancas (WCAG 1.4.11, componentes de interfaz).
  ["foco", "papel"],
  ["foco", "superficie"],
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

  it("el ancla define tokens, y cada valor es un hex de 6 dígitos o un alias de otro token que llega a uno", () => {
    expect(tokens.size).toBeGreaterThan(0);
    for (const [nombre, valor] of tokens) {
      const llega = RE_HEX.test(valor) || (RE_ALIAS.test(valor) && RE_HEX.test(resolver(tokens, nombre.slice("--color-".length))));
      expect(llega, `${nombre}: «${valor}» no es #RRGGBB ni un alias de un token que lo sea`).toBe(true);
    }
  });

  it("la superficie es blanca (las tarjetas de la administración y el fondo de la carta y del login)", () => {
    expect(resolver(tokens, "superficie")).toBe(BLANCO);
  });

  it.each(TEXTO_SOBRE_FONDO)("texto %s sobre %s: 4,5:1 como mínimo", (texto, fondo) => {
    const a = resolver(tokens, texto);
    const b = resolver(tokens, fondo);
    expect(RE_HEX.test(a) && RE_HEX.test(b), `${texto} ${a} / ${fondo} ${b}`).toBe(true);
    expect(contraste(a, b), `${texto} (${a}) sobre ${fondo} (${b})`).toBeGreaterThanOrEqual(TEXTO);
  });

  it.each(GRAFICOS_SOBRE_PAPEL)("gráfico o contorno de foco %s sobre %s: 3:1 como mínimo", (color, fondo) => {
    const a = resolver(tokens, color);
    const b = resolver(tokens, fondo);
    expect(RE_HEX.test(a) && RE_HEX.test(b), `${color} ${a} / ${fondo} ${b}`).toBe(true);
    expect(contraste(a, b), `${color} (${a}) sobre ${fondo} (${b})`).toBeGreaterThanOrEqual(GRAFICO);
  });

  it("un par con un token que el ancla no define falla con el nombre (no pasa en silencio)", () => {
    expect(() => resolver(tokens, "tinta-inventada")).toThrow(/no define --color-tinta-inventada/);
  });
});

/** Una regla de `globals.css` por su selector exacto (colapsado), con el resto de las reglas del archivo para ubicarla. */
function reglasDeGlobals(): ReglaCss[] {
  const ruta = TOKENS_VISUALES.fuente.archivo;
  return leerReglas(sinComentarios(leer(RAIZ_DEL_REPO, ruta), ruta));
}
const valorDe = (regla: ReglaCss, propiedad: string): string | undefined => regla.declaraciones.find((d) => d.propiedad === propiedad)?.valor;

describe("fondo y foco de la aplicación (Fase 6, 6.5)", () => {
  const reglas = reglasDeGlobals();

  it("el foco único (`:focus-visible`) es un contorno de 2 px del color `foco`, DENTRO de `@layer base`, y excluye la carta pública", () => {
    const foco = reglas.filter((r) => r.selector.startsWith(":focus-visible"));
    expect(foco.map((r) => r.selector)).toEqual([":focus-visible:not(.carta-shell *)"]);
    const [regla] = foco;
    expect(valorDe(regla, "outline"), "el contorno").toBe("2px solid var(--color-foco)");
    // Dentro de `@layer base`: las utilidades `focus-visible:` de Tailwind (`@layer utilities`) y las reglas sin capa le ganan; fuera de la capa pisaría los focos propios.
    const capaBase = reglas.filter((r) => r.selector === "@layer base" && r.desde < regla.desde && regla.hasta < r.hasta);
    expect(capaBase.length, "la regla del foco tiene que estar dentro de `@layer base`").toBe(1);
    // La carta pública conserva su foco temático (`.carta-shell .portal-card:focus-visible`, el de cada componente).
    expect(regla.selector).toContain(":not(.carta-shell *)");
  });

  it("el body va sobre la superficie y solo la administración (`main[data-panel]`, la que dibuja `AppShell`) va sobre el papel", () => {
    const cuerpo = reglas.find((r) => r.selector === "body");
    expect(cuerpo, "la regla `body`").toBeDefined();
    expect(valorDe(cuerpo!, "background"), "fondo del body").toBe("var(--color-superficie)");
    expect(valorDe(cuerpo!, "color"), "texto del body").toBe("var(--color-tinta)");
    const panel = reglas.find((r) => r.selector === "body:has(main[data-panel])");
    expect(panel, "la regla `body:has(main[data-panel])`").toBeDefined();
    expect(valorDe(panel!, "background"), "fondo de la administración").toBe("var(--color-papel)");
  });
});
