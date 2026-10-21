import ts from "typescript";
import { describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO, arbolDe, leer, listarArchivos } from "./cercos/trinquete";

/**
 * Guardián «separadores de la carta declarados UNA vez» (Fase 5, C13). El bug de C12 (separadores NEGROS en la tabla, la tanda y la lista) existió porque cada forma de un producto tenía que acordarse de
 * declarar el color de su separador: `divide-y` pinta el borde de abajo de cada hijo con el color DEL HIJO, y un borde sin color cae al color del texto. Ahora el color se declara en `globals.css`, una sola vez:
 *  - `.carta-shell .carta-divisor > *`: la lista que usa `divide-y` / `divide-x` lleva `carta-divisor` y sus hijos heredan el color;
 *  - `.carta-shell .carta-borde`: el elemento que dibuja su PROPIO borde con una clase de ancho (`border`, `border-t`, `border-b`…) lleva `carta-borde`.
 * Regla DURA, sin línea de base (queda en 0), sobre `src/components/carta-publica/**` (`.tsx`):
 *  (a) ningún `borderColor` suelto en un `style` con `var(--carta-border)` ni con un color literal (hex, rgb(), hsl(), oklch()…): el color de un separador no se escribe en el componente;
 *  (b) toda cadena de clases con `divide-y` / `divide-x` incluye `carta-divisor`;
 *  (c) toda cadena de clases con `border`, `border-t`, `border-b` (o `-l`, `-r`, `-x`, `-y`, con o sin grosor: `border-t-2`, `border-b-[1.5px]`) como ANCHO incluye `carta-borde`.
 *      No son un ancho: `border-collapse`, `border-dotted`, `border-spacing-*`, `border-transparent`, `border-[var(--x)]` (un color)… Exceptúa la línea fina que resuelve `carta-linea-fina`
 *      (esa lleva su propio color en `globals.css`) y las `EXCEPCIONES` de abajo (un borde que NO es un separador y tiene su propio color a propósito).
 * Se miran los literales de texto del archivo (los atributos `className`, las constantes de clases y las plantillas), no los comentarios.
 */
const RAIZ = "src/components/carta-publica";

/** Un borde que no es un separador y lleva su propio color: la cadena EXACTA, el archivo y el motivo. Una excepción sin uso sobra y falla. */
const EXCEPCIONES: readonly { archivo: string; clase: string; motivo: string }[] = [
  {
    archivo: "src/components/carta-publica/navegacion-carta.tsx",
    clase: "flex h-12 w-12 items-center justify-center rounded-full border transition-opacity hover:opacity-80 disabled:opacity-25",
    motivo: "la flecha de página es un botón circular: su borde es del color de marca/flechas (`ESTILO_FLECHA`, un color-mix de `--carta-flechas`), no un separador",
  },
  {
    archivo: "src/components/carta-publica/seccion.tsx",
    clase: "min-w-3 flex-1 -translate-y-1 border-b-[1.5px] border-dotted",
    motivo: "los puntitos entre la opción y su precio son decoración del color de la tinta atenuada (`--carta-ink-soft`), no un separador entre productos",
  },
];

/** `border`, `border-t`, `border-b-2`, `border-y`, `border-b-[1.5px]`: un ANCHO de borde (con o sin lado). Un color (`border-red-500`, `border-[var(--x)]`) o un estilo (`border-dotted`) no. */
const RE_ANCHO = /^border(?:-[tblrxyse])?(?:-(?:\d+|\[\d*\.?\d+(?:px|rem|em)\]))?$/;
/** `divide-y`, `divide-x`, `divide-y-2`: un separador entre hijos (`divide-y-reverse` o `divide-dotted` solos no lo pintan). */
const RE_DIVIDE = /^divide-[xy](?:-\d+)?$/;
/** Un color de borde literal en una clase arbitraria: `border-[#e7e5e4]`, `border-[rgb(…)]`, `border-[var(--carta-border)]`, `border-t-[oklch(…)]`. */
const RE_COLOR_EN_CLASE = /^(?:divide|border)(?:-[tblrxyse])?-\[(?:#|(?:rgb|hsl|oklch|oklab|lab|lch|hwb)a?\(|var\(--carta-border\))/;
/** Un color literal o el token del separador dentro del valor de un `borderColor`. */
const RE_COLOR_LITERAL = /carta-border|#[0-9a-f]{3,8}\b|(?:^|[^-\w])(?:rgb|hsl|oklch|oklab|lab|lch|hwb)a?\(/i;
const RE_PROPIEDAD_DE_COLOR_DE_BORDE = /^border(?:Top|Bottom|Left|Right|Block|Inline)?(?:Start|End)?Color$/;

/** El token sin las variantes (`sm:`, `hover:`, `[&>li]:`, `!`). */
const base = (token: string): string => (token.split(":").pop() ?? token).replace(/^!/, "");

interface Hallazgo {
  linea: number;
  mensaje: string;
}

/** Los hallazgos de UN archivo (fuente + ruta portable). Puro: sirve igual para el repo y para las mutaciones de los tests. */
function revisarArchivo(fuente: string, ruta: string, usadas?: Set<string>): Hallazgo[] {
  const arbol = arbolDe(fuente, ruta);
  const hallazgos: Hallazgo[] = [];
  const linea = (nodo: ts.Node): number => arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol)).line + 1;
  const aviso = (nodo: ts.Node, mensaje: string): void => {
    hallazgos.push({ linea: linea(nodo), mensaje });
  };

  const revisarClases = (nodo: ts.Node, texto: string): void => {
    const fichas = texto.split(/\s+/).filter(Boolean);
    if (fichas.length === 0) return;
    const bases = fichas.map(base);
    const tiene = (clase: string): boolean => bases.includes(clase);
    for (const f of bases) {
      if (RE_COLOR_EN_CLASE.test(f)) aviso(nodo, `\`${f}\`: el color de un separador no se escribe en una clase suelta; va en \`carta-divisor\` / \`carta-borde\` (globals.css)`);
    }
    const divide = bases.find((f) => RE_DIVIDE.test(f));
    if (divide && !tiene("carta-divisor")) aviso(nodo, `usa \`${divide}\` y le falta la clase \`carta-divisor\` (sin ella los separadores caen al color del texto): "${texto}"`);
    const ancho = bases.find((f) => RE_ANCHO.test(f));
    if (ancho && !tiene("carta-borde") && !tiene("carta-linea-fina")) {
      const excepcion = EXCEPCIONES.find((e) => e.archivo === ruta && e.clase === texto.trim().replace(/\s+/g, " "));
      if (excepcion) usadas?.add(`${excepcion.archivo}|${excepcion.clase}`);
      else aviso(nodo, `usa \`${ancho}\` y le falta la clase \`carta-borde\` (sin ella el borde cae al color del texto): "${texto}"`);
    }
  };

  /** El texto de un literal o de una plantilla (solo las partes fijas: lo que va en `${…}` no se ve). */
  const textoDe = (nodo: ts.Node): string | undefined => {
    if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) return nodo.text;
    if (ts.isTemplateExpression(nodo)) return [nodo.head.text, ...nodo.templateSpans.map((s) => s.literal.text)].join(" ");
    return undefined;
  };

  const visitar = (nodo: ts.Node): void => {
    if (ts.isPropertyAssignment(nodo) && (ts.isIdentifier(nodo.name) || ts.isStringLiteral(nodo.name)) && RE_PROPIEDAD_DE_COLOR_DE_BORDE.test(nodo.name.text)) {
      const valor = nodo.initializer.getText(arbol);
      if (RE_COLOR_LITERAL.test(valor)) aviso(nodo, `\`${nodo.name.text}: ${valor}\` suelto en un style: el color de un separador se declara UNA vez en globals.css (\`carta-divisor\` en la lista con \`divide-y\`, \`carta-borde\` en el elemento con \`border-t\`/\`border-b\`/\`border\`)`);
    }
    const texto = textoDe(nodo);
    if (texto !== undefined) {
      revisarClases(nodo, texto);
      // Una plantilla se mira entera (arriba); no se vuelve a mirar cada pedazo ni sus `${…}` como literales sueltos de otra cosa.
      if (ts.isTemplateExpression(nodo)) for (const s of nodo.templateSpans) visitar(s.expression);
      return;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return hallazgos;
}

const ARCHIVOS = (): string[] => listarArchivos(RAIZ_DEL_REPO, [RAIZ], [".tsx"]);

function hallazgosDeLaCarta(usadas?: Set<string>): string[] {
  return ARCHIVOS().flatMap((ruta) => revisarArchivo(leer(RAIZ_DEL_REPO, ruta), ruta, usadas).map((h) => `${ruta}:${h.linea}: ${h.mensaje}`));
}

describe("guardián «separadores de la carta declarados una vez»: el detector", () => {
  const revisar = (fuente: string, ruta = "src/components/carta-publica/x.tsx") => revisarArchivo(fuente, ruta).map((h) => h.mensaje);

  it("divide-y / divide-x sin carta-divisor da rojo, con el nombre de la clase que falta; con carta-divisor, no", () => {
    expect(revisar('const a = <ul className="flex divide-y">x</ul>;')).toEqual([expect.stringContaining("carta-divisor")]);
    expect(revisar('const a = <ul className="sm:divide-x">x</ul>;')).toEqual([expect.stringContaining("carta-divisor")]);
    expect(revisar('const a = <ul className="carta-divisor flex divide-y">x</ul>;')).toEqual([]);
  });

  it("border-t / border-b / border como ancho sin carta-borde da rojo; con carta-borde o con la línea fina, no", () => {
    expect(revisar('const a = <div className="mt-2 border-t">x</div>;')).toEqual([expect.stringContaining("carta-borde")]);
    expect(revisar('const a = <div className="border-b-[1.5px]">x</div>;')).toEqual([expect.stringContaining("carta-borde")]);
    expect(revisar('const a = <div className={`md:border ${x}`}>x</div>;')).toEqual([expect.stringContaining("carta-borde")]);
    expect(revisar('const a = <div className={ok ? "carta-borde mt-2 border-t" : undefined}>x</div>;')).toEqual([]);
    expect(revisar('const a = <div className="carta-linea-fina border-b">x</div>;')).toEqual([]);
  });

  it("lo que no es un ancho de borde no da falso positivo (border-collapse, border-dotted, border-spacing, border-transparent, border-[var(--x)], rounded-full)", () => {
    expect(revisar('const a = <table className="w-full border-collapse border-spacing-2 border-dotted border-transparent border-[var(--x)] rounded-full">x</table>;')).toEqual([]);
  });

  it("un borderColor suelto con var(--carta-border) o un color literal da rojo; con un color-mix de otros tokens, no; los comentarios no cuentan", () => {
    expect(revisar('const a = <li style={{ borderColor: "var(--carta-border)" }}>x</li>;')).toEqual([expect.stringContaining("borderColor")]);
    expect(revisar('const a = <li style={{ borderBottomColor: "#e7e5e4" }}>x</li>;')).toEqual([expect.stringContaining("borderBottomColor")]);
    expect(revisar('const a = <li style={{ borderColor: "rgb(231, 229, 228)" }}>x</li>;')).toEqual([expect.stringContaining("borderColor")]);
    expect(revisar('const e = { borderColor: "color-mix(in oklch, var(--carta-flechas) 45%, transparent)" };')).toEqual([]);
    expect(revisar('// style={{ borderColor: "var(--carta-border)" }} y un divide-y\nconst a = 1;')).toEqual([]);
  });

  it("un color literal en una clase arbitraria da rojo", () => {
    expect(revisar('const a = <li className="carta-borde border-b border-[#e7e5e4]">x</li>;')).toEqual([expect.stringContaining("border-[#e7e5e4]")]);
  });
});

describe("guardián «separadores de la carta declarados una vez» (regla dura, sin línea de base): src/components/carta-publica", () => {
  it("hay archivos que mirar", () => {
    expect(ARCHIVOS().length).toBeGreaterThan(3);
  });

  it("ningún borderColor suelto, ningún divide-y sin carta-divisor ni border-t/border-b/border sin carta-borde (salvo la línea fina y las excepciones con motivo)", () => {
    expect(hallazgosDeLaCarta()).toEqual([]);
  });

  it("cada excepción con motivo sigue siendo necesaria (una excepción sin uso sobra)", () => {
    const usadas = new Set<string>();
    hallazgosDeLaCarta(usadas);
    expect(EXCEPCIONES.filter((e) => !usadas.has(`${e.archivo}|${e.clase}`)).map((e) => `${e.archivo}: ${e.clase}`)).toEqual([]);
    for (const e of EXCEPCIONES) expect(e.motivo.length).toBeGreaterThan(20);
  });
});
