import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TOKENS_VISUALES } from "./contratos/tokens-visuales";
import { revisarContratos } from "./motor";
import type { Contrato, TipoDeHallazgo } from "./tipos";

/**
 * Las MUTACIONES del contrato `tokens-visuales` (Fase 6, paso 6.1) con su declaración REAL del manifiesto, sobre un árbol TEMPORAL (nunca el repo) y sin su deuda inicial: la deuda
 * (DEC-03) cubre usos reales de hoy (los alias de `.pos-shell`, la paleta de la carta del panel, `:root`) que en un árbol de prueba no existen, así que acá el contrato corre limpio y
 * cada caso rojo es una mutación que el guardián tiene que ver. El mismo patrón que `contratos-de-la-carta.test.ts`.
 *
 * `declaracion-sin-uso` SÍ aplica a este contrato: con `nombre-definido-en-la-fuente` un token definido en `@theme static` que nadie usa es un hallazgo.
 */
let raiz: string;

const GLOBALS = `/* @contrato tokens-visuales */
@theme static {
  --color-papel: #FAFAF8;
  --color-tinta: #1C1B19;
}
.pos-shell {
  background: var(--color-papel);
}
`;
const OK_TSX = 'export const A = () => <p className="bg-papel text-tinta hover:bg-papel/50 md:text-tinta">x</p>;\n';
const RUTA = "src/components/x.tsx";
const RUTA_CSS = "src/app/(app)/carta/carta-mant.module.css";

function escribir(archivos: Record<string, string>): void {
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const absoluta = join(raiz, ...ruta.split("/"));
    mkdirSync(dirname(absoluta), { recursive: true });
    writeFileSync(absoluta, contenido);
  }
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "contratos-tokens-"));
  escribir({ "src/app/globals.css": GLOBALS, "src/components/ok.tsx": OK_TSX });
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

const sinDeuda: Contrato = { ...TOKENS_VISUALES, deuda: [] };
type Obtenido = [TipoDeHallazgo, string, number, number];
function correr(): Obtenido[] {
  return revisarContratos({ raiz, contratos: [sinDeuda], hoy: "2026-10-21" }).hallazgos.map((h) => [h.tipo, h.archivo, h.linea, h.columna]);
}
/** Escribe `texto` en `ruta` y devuelve dónde (línea y columna, 1-based) empieza `donde` dentro de él. */
function con(ruta: string, texto: string, donde: string): { linea: number; columna: number } {
  escribir({ [ruta]: texto });
  const antes = texto.slice(0, texto.indexOf(donde));
  const lineas = antes.split("\n");
  return { linea: lineas.length, columna: lineas[lineas.length - 1].length + 1 };
}
const esperado = (tipo: TipoDeHallazgo, ruta: string, p: { linea: number; columna: number }): Obtenido => [tipo, ruta, p.linea, p.columna];

describe("contrato tokens-visuales: los tokens del sistema visual", () => {
  it("el árbol de base (tokens definidos una vez en @theme static y usados en una clase y en un var()) da verde, sin deuda", () => {
    expect(correr()).toEqual([]);
  });

  it("un token mal escrito en una clase (text-tinta-sueve, bg-papell) da uso-sin-declarar, con la posición del token; con variantes y opacidad también", () => {
    expect(correr()).toEqual([]);
    let p = con(RUTA, 'export const A = () => <p className="text-tinta-sueve">x</p>;\n', "text-tinta-sueve");
    expect(correr()).toEqual([esperado("uso-sin-declarar", RUTA, p)]);
    p = con(RUTA, 'export const A = () => <p className="mt-2 bg-papell">x</p>;\n', "bg-papell");
    expect(correr()).toEqual([esperado("uso-sin-declarar", RUTA, p)]);
    p = con(RUTA, 'export const A = () => <p className="hover:bg-papell/50">x</p>;\n', "hover:bg-papell/50");
    expect(correr()).toEqual([esperado("uso-sin-declarar", RUTA, p)]);
  });

  it("CADA token de la cadena cuenta: dos errores en la misma cadena son dos hallazgos", () => {
    escribir({ [RUTA]: 'export const A = () => <p className="bg-papell text-tinta text-tinta-sueve">x</p>;\n' });
    expect(correr().map((h) => [h[0], h[3]])).toEqual([
      ["uso-sin-declarar", 'export const A = () => <p className="'.length + 1],
      ["uso-sin-declarar", 'export const A = () => <p className="bg-papell text-tinta '.length + 1],
    ]);
  });

  it("un var(--color-…) que la fuente no define, en un CSS, da uso-sin-declarar", () => {
    const p = con("src/components/x.module.css", ".a {\n  color: var(--color-papell);\n}\n", "--color-papell");
    expect(correr()).toEqual([esperado("uso-sin-declarar", "src/components/x.module.css", p)]);
    escribir({ "src/components/x.module.css": ".a {\n  color: var(--color-tinta);\n}\n" });
    expect(correr()).toEqual([]);
  });

  it("las clases de otra cosa no dan falso positivo (text-sm, bg-white, border-b, border-collapse, shadow-md, ring-1, divide-y, outline-none, fill-current)", () => {
    escribir({ [RUTA]: 'export const A = () => <p className="text-sm bg-white border-b border-collapse shadow-md ring-1 divide-y outline-none fill-current text-neutral-500 mt-2">x</p>;\n' });
    expect(correr()).toEqual([]);
  });

  it("redefinir un token (--color-tinta: red) en un .module.css da definicion-duplicada", () => {
    const p = con(RUTA_CSS, ".x {\n  --color-tinta: red;\n}\n", "--color-tinta");
    expect(correr()).toEqual([esperado("definicion-duplicada", RUTA_CSS, p)]);
  });

  it("un segundo --color-papel en .pos-shell (fuera del ancla) da definicion-duplicada en esa línea", () => {
    const texto = `${GLOBALS}.pos-shell {\n  --color-papel: #FFFFFF;\n}\n`;
    const p = con("src/app/globals.css", texto, "--color-papel: #FFFFFF");
    expect(correr()).toEqual([esperado("definicion-duplicada", "src/app/globals.css", p)]);
  });

  it("un segundo --color-papel dentro de @theme static también es definicion-duplicada (vale la primera definición)", () => {
    const texto = GLOBALS.replace("  --color-tinta: #1C1B19;\n", "  --color-tinta: #1C1B19;\n  --color-papel: #FFFFFF;\n");
    const p = con("src/app/globals.css", texto, "--color-papel: #FFFFFF");
    expect(correr()).toEqual([esperado("definicion-duplicada", "src/app/globals.css", p)]);
  });

  it("definir un alias de color del salón (--paper, --ink, --mesa-libre-tint…) o un --background suelto fuera de la fuente da definicion-duplicada", () => {
    let p = con(RUTA_CSS, ".raiz {\n  --ink: #15202b;\n}\n", "--ink");
    expect(correr()).toEqual([esperado("definicion-duplicada", RUTA_CSS, p)]);
    p = con(RUTA_CSS, ".raiz {\n  --mesa-libre-tint: #EBF3EE;\n}\n", "--mesa-libre-tint");
    expect(correr()).toEqual([esperado("definicion-duplicada", RUTA_CSS, p)]);
    escribir({ [RUTA_CSS]: ".raiz {\n  color: red;\n}\n" });
    p = con("src/app/globals.css", `${GLOBALS}:root {\n  --background: #ffffff;\n}\n`, "--background");
    expect(correr()).toEqual([esperado("definicion-duplicada", "src/app/globals.css", p)]);
    // Una variable propia de la pantalla que no es un alias del salón ni un token no es de este contrato.
    escribir({ "src/app/globals.css": GLOBALS, [RUTA_CSS]: ".raiz {\n  --nav: #1b2735;\n  --carta-bg: #fff;\n}\n" });
    expect(correr()).toEqual([]);
  });

  it("un token definido en la fuente que nadie usa da declaracion-sin-uso (aplica a este contrato), en la línea de su definición", () => {
    const texto = GLOBALS.replace("  --color-tinta: #1C1B19;\n", "  --color-tinta: #1C1B19;\n  --color-aviso: #B8860B;\n");
    const p = con("src/app/globals.css", texto, "--color-aviso");
    expect(correr()).toEqual([esperado("declaracion-sin-uso", "src/app/globals.css", p)]);
    // Con un uso (en una clase) deja de serlo.
    escribir({ "src/components/aviso.tsx": 'export const B = () => <p className="text-aviso">x</p>;\n' });
    expect(correr()).toEqual([]);
  });

  it("una mención en un comentario no es un uso ni una definición (TS y CSS)", () => {
    escribir({
      [RUTA]: '// el color text-tinta-sueve o bg-papell no existe; var(--color-papell) tampoco\n/** hover:bg-papell */\nexport const A = () => <p className="mt-2">x</p>;\n',
      [RUTA_CSS]: "/* --color-tinta: red; var(--color-papell); --paper: red; --background: red */\n.x {\n  color: red;\n}\n",
    });
    expect(correr()).toEqual([]);
  });

  it("sin la marca en la fuente da fuente-ausente en la línea del ancla; sin el ancla, en la de la marca", () => {
    escribir({ "src/app/globals.css": GLOBALS.replace("/* @contrato tokens-visuales */\n", "") });
    expect(correr()).toEqual([["fuente-ausente", "src/app/globals.css", 1, 1]]);
    escribir({ "src/app/globals.css": GLOBALS.replace("@theme static", "@theme inline") });
    expect(correr().map((h) => h[0])).toContain("fuente-ausente");
  });
});
