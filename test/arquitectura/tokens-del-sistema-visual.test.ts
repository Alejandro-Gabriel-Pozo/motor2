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
 * Los tokens CON ALFA (`velo`, `sombra`, `borde-sobre-tinta`: `rgb(r g b / a)`, 6.4) NO se miden: su contraste depende de lo que haya detrás (un velo sobre una hoja, una sombra, el borde de un botón
 * sobre `tinta`), no es un par fijo. Solo se exige que tengan la forma `rgb(r g b / a)` y que sean exactamente esos tres: un token con alfa nuevo se agrega acá a propósito.
 * Dos tokens de 6.4 se miden aparte: `borde-control` (el borde de los controles, >= 3:1 contra superficie y papel, WCAG 1.4.11) y `superficie-suave` (el fondo de los chips y del botón «maestro» de
 * la carta del panel), sobre el que `tinta-tenue` NO sirve como texto (4,17:1): ver el bloque «carta del panel».
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
/** Un token con transparencia: `rgb(28 27 25 / 0.55)`. No tiene un par de contraste fijo (ver el encabezado). */
const RE_RGB_ALFA = /^rgb\(\d{1,3} \d{1,3} \d{1,3} \/ 0?\.\d+\)$/;
const TOKENS_CON_ALFA = ["--color-borde-sobre-tinta", "--color-sombra", "--color-velo"];

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
  // 6.6g: la insignia de tono `marca` (`insignia.tsx`): texto `marca` sobre el tinte de la marca (5,34:1).
  ["marca", "marca-tinte"],
  // 6.4: la carta del panel (`carta-mant.module.css`). `tinta-tenue` NO está acá sobre `superficie-suave` ni sobre los tintes: no llega (ver «carta del panel»).
  ["tinta", "superficie-suave"],
  ["tinta-suave", "superficie-suave"],
  ["tinta", "aviso-tinte"],
  ["tinta-suave", "aviso-tinte"],
  [BLANCO, "error"],
];
const GRAFICOS_SOBRE_PAPEL: readonly (readonly [string, string])[] = [
  ["ok", "papel"],
  ["aviso", "papel"],
  ["error", "papel"],
  // 6.5: el contorno del foco de teclado, contra el papel de la administración y contra las tarjetas blancas (WCAG 1.4.11, componentes de interfaz).
  ["foco", "papel"],
  ["foco", "superficie"],  // 6.4: el borde de los controles (WCAG 1.4.11, contorno de un componente de interfaz) contra la superficie blanca y contra el papel de la administración.
  ["borde-control", "superficie"],
  ["borde-control", "papel"],
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

  it("el ancla define tokens, y cada valor es un hex de 6 dígitos, un alias de otro token que llega a uno o (solo velo, sombra y borde-sobre-tinta) un rgb con alfa", () => {
    expect(tokens.size).toBeGreaterThan(0);
    for (const [nombre, valor] of tokens) {
      if (TOKENS_CON_ALFA.includes(nombre)) continue;
      const llega = RE_HEX.test(valor) || (RE_ALIAS.test(valor) && RE_HEX.test(resolver(tokens, nombre.slice("--color-".length))));
      expect(llega, `${nombre}: «${valor}» no es #RRGGBB ni un alias de un token que lo sea`).toBe(true);
    }
  });

  it("los tokens con alfa son exactamente velo, sombra y borde-sobre-tinta, escritos `rgb(r g b / a)` (no se miden: su contraste depende de lo que hay detrás)", () => {
    const conAlfa = [...tokens].filter(([, valor]) => valor.startsWith("rgb(")).map(([nombre]) => nombre).sort();
    expect(conAlfa).toEqual(TOKENS_CON_ALFA);
    for (const nombre of TOKENS_CON_ALFA) expect(RE_RGB_ALFA.test(tokens.get(nombre) ?? ""), `${nombre}: «${tokens.get(nombre)}»`).toBe(true);
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

describe("carta del panel (Fase 6, 6.4): `tinta-tenue` no se usa como texto sobre `superficie-suave` ni sobre los tintes", () => {
  const RUTA = "src/app/(app)/carta/carta-mant.module.css";
  const reglas = leerReglas(sinComentarios(leer(RAIZ_DEL_REPO, RUTA), RUTA));
  const tokens = tokensDelAncla();
  const fondoDe = (r: ReglaCss): string | undefined => valorDe(r, "background") ?? valorDe(r, "background-color");
  /** Las reglas que pintan el texto con `tinta-tenue`. */
  const conTenue = reglas.filter((r) => valorDe(r, "color") === "var(--color-tinta-tenue)");

  it("`tinta-tenue` sobre `superficie-suave` y sobre los tintes de aviso y ok no llega a 4,5:1 (por eso no se usa ahí)", () => {
    for (const fondo of ["superficie-suave", "aviso-tinte", "ok-tinte", "error-tinte"]) {
      expect(contraste(resolver(tokens, "tinta-tenue"), resolver(tokens, fondo)), `tinta-tenue sobre ${fondo}`).toBeLessThan(TEXTO);
    }
  });

  it("ninguna regla de la carta pinta texto `tinta-tenue` sobre un fondo suave o tintado en la misma regla", () => {
    expect(conTenue.length, "la carta usa tinta-tenue en los rótulos y los iconos").toBeGreaterThan(0);
    for (const r of conTenue) {
      expect(["", "transparent", "var(--color-superficie)", "var(--color-papel)"], `${r.selector}: texto tinta-tenue sobre ${fondoDe(r)}`).toContain(fondoDe(r) ?? "");
    }
  });

  it("los lugares donde se usa `tinta-tenue` son estos (todos sobre la superficie blanca de una tarjeta o el papel); un lugar nuevo se agrega acá midiendo su fondo", () => {
    // `.contador small` y `.ordenN` tienen una variante con el fondo tintado de aviso (`aria-pressed`, `ordenElegida`) que cambia el texto a `tinta-suave`.
    expect(conTenue.map((r) => r.selector).sort()).toEqual([".chevron", ".contador small", ".flecha", ".ordenN", ".rotulo"]);
    for (const selector of [".contador[aria-pressed=\"true\"] small", ".ordenElegida .ordenN"]) {
      const regla = reglas.find((r) => r.selector === selector);
      expect(regla, selector).toBeDefined();
      expect(valorDe(regla!, "color"), selector).toBe("var(--color-tinta-suave)");
    }
  });

  it("ninguna regla de la carta declara un color suelto ni una variable propia: todo sale de `--color-*`", () => {
    for (const r of reglas) {
      for (const d of r.declaraciones) {
        expect(d.propiedad.startsWith("--"), `${r.selector}: define ${d.propiedad} (la carta del panel no trae paleta propia)`).toBe(false);
        expect(/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(d.valor), `${r.selector}: ${d.propiedad}: ${d.valor}`).toBe(false);
      }
    }
  });
});
