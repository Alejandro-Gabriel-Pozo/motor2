import ts from "typescript";
import { describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO, arbolDe, leer, listarArchivos } from "./cercos/trinquete";

/**
 * Regla «`Boton` no se dibuja desde un componente de servidor» (Fase 6, paso 6.8; base 0, sin línea de base: no hay deuda que congelar). No es un contrato ni un cerco de trinquete: es una
 * regla dura más de `test/arquitectura`.
 *
 * Por qué: la primitiva `Boton` (`src/ui/primitivas/boton.tsx`) no lleva `"use client"` y SIEMPRE le pone un `onClick` al `<button>` (el que ignora el clic mientras `cargando`). Dibujada desde un
 * componente de servidor (un archivo sin la directiva), Next la trata como parte del servidor y corta en ejecución con «Event handlers cannot be passed to Client Component props» (un 500 que
 * ni `tsc` ni el lint ven, porque el tipo de las props es válido). Para eso existe `src/components/boton-de-servidor.tsx`, el límite de cliente de tres líneas: el servidor le pasa solo datos
 * (variante, tamaño, hijos, atributos serializables) y el `<button>` se dibuja y se hidrata allá.
 *
 * Qué mira: el AST de cada `.tsx` de `src/app` y `src/components` que NO empieza con la directiva `"use client"` (los de cliente pueden usar `Boton` directo). Es una violación importar `Boton` de
 * `@/ui/primitivas/boton` (nombrado, con alias, o `Ns.Boton` de un `import * as Ns`) y usarlo como elemento JSX (`<Boton …>`); tiene que ser `BotonDeServidor`. Importarlo para usar solo su tipo o
 * `claseDeBoton` no es un elemento JSX y no cuenta. Los tests no están en `src/`, así que quedan fuera por construcción.
 *
 * LÍMITE DOCUMENTADO: un archivo sin la directiva que recibe `Boton` como propiedad (`const B = props.boton; <B />`) o lo reexporta con otro nombre no se ve: solo se sigue la importación directa.
 */

const MODULO_DEL_BOTON = "@/ui/primitivas/boton";

interface Violacion {
  /** El nombre del elemento tal como está escrito (`Boton`, `B`, `Ns.Boton`). */
  elemento: string;
  linea: number;
}

/** El archivo abre con la directiva `"use client"` (cualquiera de las del prólogo: las sentencias de solo un string del principio del archivo). */
function esDeCliente(arbol: ts.SourceFile): boolean {
  for (const sentencia of arbol.statements) {
    if (!ts.isExpressionStatement(sentencia) || !ts.isStringLiteral(sentencia.expression)) return false;
    if (sentencia.expression.text === "use client") return true;
  }
  return false;
}

/** Es el módulo de la primitiva: el alias `@/ui/primitivas/boton` (así se importa en todo `src/`) o una ruta relativa que termina igual. */
function esElModuloDelBoton(especificador: string): boolean {
  return especificador === MODULO_DEL_BOTON || /(?:^|\/)ui\/primitivas\/boton$/.test(especificador);
}

/** Los nombres locales con los que el archivo tiene a `Boton`: `Boton`, un alias (`import { Boton as B }`) o el espacio de nombres (`import * as Ns`, que se usa como `<Ns.Boton`). */
function nombresDelBoton(arbol: ts.SourceFile): { directos: Set<string>; espacios: Set<string> } {
  const directos = new Set<string>();
  const espacios = new Set<string>();
  for (const sentencia of arbol.statements) {
    if (!ts.isImportDeclaration(sentencia) || !ts.isStringLiteral(sentencia.moduleSpecifier) || !esElModuloDelBoton(sentencia.moduleSpecifier.text)) continue;
    const enlaces = sentencia.importClause?.namedBindings;
    if (!enlaces) continue;
    if (ts.isNamespaceImport(enlaces)) espacios.add(enlaces.name.text);
    else for (const e of enlaces.elements) if ((e.propertyName ?? e.name).text === "Boton") directos.add(e.name.text);
  }
  return { directos, espacios };
}

/** Cada `<Boton` que un archivo SIN `"use client"` dibuja en `fuente`. */
function violacionesDe(fuente: string, ruta: string): Violacion[] {
  const arbol = arbolDe(fuente, ruta);
  if (esDeCliente(arbol)) return [];
  const { directos, espacios } = nombresDelBoton(arbol);
  const salida: Violacion[] = [];
  if (directos.size === 0 && espacios.size === 0) return salida;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) {
      const etiqueta = nodo.tagName;
      const esElBoton = ts.isIdentifier(etiqueta)
        ? directos.has(etiqueta.text)
        : ts.isPropertyAccessExpression(etiqueta) && ts.isIdentifier(etiqueta.expression) && espacios.has(etiqueta.expression.text) && etiqueta.name.text === "Boton";
      if (esElBoton) salida.push({ elemento: etiqueta.getText(arbol), linea: arbol.getLineAndCharacterOfPosition(nodo.getStart(arbol)).line + 1 });
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return salida;
}

describe("regla «Boton no se dibuja desde un componente de servidor»: el detector", () => {
  const importar = 'import { Boton } from "@/ui/primitivas/boton";\n';

  it("un componente de servidor (sin la directiva) que dibuja <Boton> es una violación (la fixture de la mutación)", () => {
    const fuente = `${importar}export function Cabecera() {\n  return <Boton type="submit">Salir</Boton>;\n}`;
    expect(violacionesDe(fuente, "x.tsx")).toEqual([{ elemento: "Boton", linea: 3 }]);
  });

  it("un archivo con \"use client\" puede dibujar <Boton> directo", () => {
    expect(violacionesDe(`"use client";\n${importar}export const F = () => <Boton>x</Boton>;`, "x.tsx")).toEqual([]);
    expect(violacionesDe(`'use client'\n${importar}export const F = () => <Boton>x</Boton>;`, "x.tsx")).toEqual([]);
    // La directiva puede ir detrás de otra del prólogo, pero no detrás de una sentencia de código.
    expect(violacionesDe(`"use strict";\n"use client";\n${importar}export const F = () => <Boton>x</Boton>;`, "x.tsx")).toEqual([]);
    expect(violacionesDe(`${importar}"use client";\nexport const F = () => <Boton>x</Boton>;`, "x.tsx")).toHaveLength(1);
  });

  it("<BotonDeServidor> es lo que se usa en un componente de servidor: no es una violación", () => {
    const fuente = 'import { BotonDeServidor } from "./boton-de-servidor";\nexport const F = () => <BotonDeServidor type="submit">Salir</BotonDeServidor>;';
    expect(violacionesDe(fuente, "x.tsx")).toEqual([]);
  });

  it("sigue al alias, al espacio de nombres y a la ruta relativa; cuenta el elemento con y sin hijos", () => {
    const alias = 'import { Boton as B } from "@/ui/primitivas/boton";\nexport const F = () => <><B>x</B><B /></>;';
    expect(violacionesDe(alias, "x.tsx")).toEqual([
      { elemento: "B", linea: 2 },
      { elemento: "B", linea: 2 },
    ]);
    const espacio = 'import * as Ui from "@/ui/primitivas/boton";\nexport const F = () => <Ui.Boton>x</Ui.Boton>;';
    expect(violacionesDe(espacio, "x.tsx")).toEqual([{ elemento: "Ui.Boton", linea: 2 }]);
    const relativa = 'import { Boton } from "../../ui/primitivas/boton";\nexport const F = () => <Boton>x</Boton>;';
    expect(violacionesDe(relativa, "x.tsx")).toHaveLength(1);
  });

  it("importar solo claseDeBoton o el tipo, o tener otro componente que se llama igual, no es una violación", () => {
    const soloClase = 'import { claseDeBoton, type PropsDeBoton } from "@/ui/primitivas/boton";\nexport const F = (p: PropsDeBoton) => <a className={claseDeBoton(p.variante)}>x</a>;';
    expect(violacionesDe(soloClase, "x.tsx")).toEqual([]);
    const homonimo = 'import { Boton } from "@/components/otro-boton";\nexport const F = () => <Boton>x</Boton>;';
    expect(violacionesDe(homonimo, "x.tsx")).toEqual([]);
    const sinImportar = "export const F = () => <button>x</button>;";
    expect(violacionesDe(sinImportar, "x.tsx")).toEqual([]);
  });
});

describe("regla «Boton no se dibuja desde un componente de servidor»: el repo", () => {
  it("ningún .tsx de src/app ni de src/components sin \"use client\" dibuja <Boton> de @/ui/primitivas/boton: usa BotonDeServidor", () => {
    const hallazgos: string[] = [];
    for (const ruta of listarArchivos(RAIZ_DEL_REPO, ["src/app", "src/components"], [".tsx"])) {
      for (const v of violacionesDe(leer(RAIZ_DEL_REPO, ruta), ruta)) hallazgos.push(`${ruta}:${v.linea}  <${v.elemento}>`);
    }
    expect(
      hallazgos,
      `Un componente de servidor (sin "use client") no puede dibujar <Boton>: la primitiva siempre le pone un onClick al <button> y Next corta con «Event handlers cannot be passed to Client Component props». Se usa <BotonDeServidor> (src/components/boton-de-servidor.tsx), o el archivo pasa a ser de cliente.\n${hallazgos.join("\n")}`,
    ).toEqual([]);
  });
});
