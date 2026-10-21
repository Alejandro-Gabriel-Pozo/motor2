import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BORDE_PROPIO_DE_CARTA } from "./contratos/borde-propio-de-carta";
import { SEPARADOR_DE_LISTA_DE_CARTA } from "./contratos/separador-de-lista-de-carta";
import { revisarContratos } from "./motor";
import type { Contrato, TipoDeHallazgo } from "./tipos";

/**
 * Las MUTACIONES de los dos contratos de la carta (`separador-de-lista-de-carta` y `borde-propio-de-carta`) con sus declaraciones REALES del manifiesto, sobre un árbol
 * TEMPORAL (nunca el repo). Son los casos que tenía el guardián local `carta-separadores-declarados.test.ts` (retirado en el paso G3b): el motor común tiene que dar rojo
 * en lo mismo y verde en lo mismo. Las dos excepciones del contrato real se prueban aparte: en estos árboles se vacían para que no sobren.
 */
let raiz: string;

const GLOBALS = `/* @contrato separador-de-lista-de-carta */
.carta-shell .carta-divisor > * {
  border-color: var(--carta-border);
}
/* @contrato borde-propio-de-carta */
.carta-shell .carta-borde {
  border-color: var(--carta-border);
}
.carta-shell .carta-linea-fina {
  border-bottom: 1px solid red;
}
`;
const OK = 'export const A = () => <ul className="carta-divisor flex divide-y"><li className="carta-borde mt-2 border-t">x</li></ul>;\n';
const RUTA = "src/components/carta-publica/x.tsx";

function escribir(archivos: Record<string, string>): void {
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const absoluta = join(raiz, ...ruta.split("/"));
    mkdirSync(dirname(absoluta), { recursive: true });
    writeFileSync(absoluta, contenido);
  }
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), "contratos-carta-"));
  escribir({ "src/app/globals.css": GLOBALS, "src/components/carta-publica/ok.tsx": OK });
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

const sinExcepciones = (c: Contrato): Contrato => ({ ...c, excepciones: [] });
function correr(contratos: readonly Contrato[] = [SEPARADOR_DE_LISTA_DE_CARTA, sinExcepciones(BORDE_PROPIO_DE_CARTA)]): [string, TipoDeHallazgo, number, number][] {
  return revisarContratos({ raiz, contratos, hoy: "2026-10-21" }).hallazgos.map((h) => [h.contrato, h.tipo, h.linea, h.columna]);
}
let ultima = "";
const con = (fuente: string): void => {
  ultima = fuente;
  escribir({ [RUTA]: fuente });
};
/** El hallazgo esperado en la línea 1, en la columna donde empieza `donde` dentro del último archivo escrito (el token que molesta). */
const en = (contrato: string, tipo: TipoDeHallazgo, donde: string): [string, TipoDeHallazgo, number, number] => [contrato, tipo, 1, ultima.indexOf(donde) + 1];

describe("contratos de la carta: separadores", () => {
  it("el árbol de base da verde", () => {
    expect(correr()).toEqual([]);
  });

  it("divide-y / divide-x sin carta-divisor da rojo (con variantes también); con carta-divisor, no", () => {
    con('const a = <ul className="flex divide-y">x</ul>;\n');
    expect(correr()).toEqual([en("separador-de-lista-de-carta", "uso-sin-declarar", "divide-y")]);
    con('const a = <ul className="sm:divide-x">x</ul>;\n');
    expect(correr()).toEqual([en("separador-de-lista-de-carta", "uso-sin-declarar", "sm:divide-x")]);
    con('const a = <ul className="carta-divisor flex divide-y">x</ul>;\n');
    expect(correr()).toEqual([]);
  });

  it("border-t / border-b / border como ancho sin carta-borde da rojo; con carta-borde o con la línea fina, no", () => {
    con('const a = <div className="mt-2 border-t">x</div>;\n');
    expect(correr()).toEqual([en("borde-propio-de-carta", "uso-sin-declarar", "border-t")]);
    con('const a = <div className="border-b-[1.5px]">x</div>;\n');
    expect(correr()).toEqual([en("borde-propio-de-carta", "uso-sin-declarar", "border-b-[1.5px]")]);
    con("const a = <div className={`md:border ${x}`}>x</div>;\n");
    expect(correr()).toEqual([en("borde-propio-de-carta", "uso-sin-declarar", "md:border")]);
    con('const a = <div className={ok ? "carta-borde mt-2 border-t" : undefined}>x</div>;\n');
    expect(correr()).toEqual([]);
    con('const a = <div className="carta-linea-fina border-b">x</div>;\n');
    expect(correr()).toEqual([]);
  });

  it("lo que no es un ancho de borde no da falso positivo (border-collapse, border-dotted, border-spacing, border-transparent, border-[var(--x)], rounded-full)", () => {
    con('const a = <table className="w-full border-collapse border-spacing-2 border-dotted border-transparent border-[var(--x)] rounded-full">x</table>;\n');
    expect(correr()).toEqual([]);
  });

  it("un borderColor suelto con var(--carta-border) o un color literal da rojo; con un color-mix de otros tokens, no; los comentarios no cuentan", () => {
    con('const a = <li style={{ borderColor: "var(--carta-border)" }}>x</li>;\n');
    expect(correr()).toEqual([en("borde-propio-de-carta", "definicion-duplicada", "borderColor")]);
    con('const a = <li style={{ borderBottomColor: "#e7e5e4" }}>x</li>;\n');
    expect(correr()).toEqual([en("borde-propio-de-carta", "definicion-duplicada", "borderBottomColor")]);
    con('const a = <li style={{ borderColor: "rgb(231, 229, 228)" }}>x</li>;\n');
    expect(correr()).toEqual([en("borde-propio-de-carta", "definicion-duplicada", "borderColor")]);
    con('const e = { borderColor: "color-mix(in oklch, var(--carta-flechas) 45%, transparent)" };\n');
    expect(correr()).toEqual([]);
    con('// style={{ borderColor: "var(--carta-border)" }} y un divide-y\nconst a = 1;\n');
    expect(correr()).toEqual([]);
  });

  it("un color literal en una clase arbitraria (border-[#e7e5e4], divide-[#e7e5e4]) da rojo", () => {
    con('const a = <li className="carta-borde border-b border-[#e7e5e4]">x</li>;\n');
    expect(correr()).toEqual([en("borde-propio-de-carta", "definicion-duplicada", "border-[#e7e5e4]")]);
    con('const a = <ul className="carta-divisor divide-y divide-[#e7e5e4]">x</ul>;\n');
    expect(correr()).toEqual([en("separador-de-lista-de-carta", "definicion-duplicada", "divide-[#e7e5e4]")]);
  });

  it("las dos excepciones del contrato real (la flecha de página y los puntitos) cubren su cadena exacta; otra cadena con border sin carta-borde sigue en rojo", () => {
    const flecha = BORDE_PROPIO_DE_CARTA.excepciones[0];
    const puntitos = BORDE_PROPIO_DE_CARTA.excepciones[1];
    escribir({ [flecha.archivo]: `const CLASE_FLECHA = "${flecha.fragmento}";\n`, [puntitos.archivo]: `export const P = () => <span className="${puntitos.fragmento}" />;\n` });
    expect(correr([SEPARADOR_DE_LISTA_DE_CARTA, BORDE_PROPIO_DE_CARTA])).toEqual([]);
    escribir({ [flecha.archivo]: `const CLASE_FLECHA = "${flecha.fragmento} mt-1";\n` });
    expect(correr([SEPARADOR_DE_LISTA_DE_CARTA, BORDE_PROPIO_DE_CARTA]).map((h) => h[1])).toEqual(["excepcion-sobrante", "uso-sin-declarar"]);
  });
});
