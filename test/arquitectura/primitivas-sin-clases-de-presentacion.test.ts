import ts from "typescript";
import { describe, expect, it } from "vitest";
import { sinVariantes } from "./contratos/adaptadores/clases-tsx";
import { RAIZ_DEL_REPO, arbolDe, leer, listarArchivos } from "./cercos/trinquete";

/**
 * Regla dura «primitivas sin clases de presentación» (Fase 6, paso 6.7; base 0, sin línea de base: no hay deuda que congelar). Quien usa una primitiva del sistema de diseño (`src/ui/…`: `Boton`,
 * `Campo`, `Aviso`, `Enlace`, `Dialogo`…) no le pinta el aspecto desde afuera: el color, el borde, la tipografía y el relleno los decide la primitiva con sus variantes. Un `className` con
 * `bg-red-700` sobre un `<Boton>` es justo la pantalla que se vuelve a inventar su propio botón, y deja de cambiar cuando cambia el sistema.
 *
 * Qué mira: el AST de los `.tsx` de `src/app` y `src/components` (no `src/ui`, que es la fuente, ni `plataforma/`, que es otra app). Un elemento JSX cuyo nombre se importa de `@/ui/…` (nombrado,
 * con alias, por defecto, o `Ns.Elemento` de un `import * as Ns`), con un atributo `className` cuyo literal —un string, una plantilla sin sustituciones, o las partes fijas de una plantilla con
 * `${…}`, y los literales de una expresión (`cond ? "a" : "b"`)— trae una clase que NO es de ubicación ni de tamaño.
 *
 * Qué admite (la primitiva no sabe dónde la ponen, así que eso sí lo decide quien la usa):
 *  - márgenes: `m-*`, `mx-*`, `my-*`, `mt-*`, `mr-*`, `mb-*`, `ml-*`, `ms-*`, `me-*` (también negativos, `-mt-2`);
 *  - ancho: `w-*`, `min-w-*`, `max-w-*`, `basis-*`;
 *  - ubicación en el contenedor: `self-*`, `justify-self-*`, `col-span-*`, `col-start-*`, `row-span-*`, `order-*`, `flex-1`, `grow`, `shrink-0`;
 *  - visibilidad: `hidden` y `block`;
 *  - con las variantes de ancho de pantalla `sm|md|lg|xl|max-sm|max-md|max-lg`. Cualquier otra variante (`hover:`, `dark:`, `focus-visible:`, `[&>p]:`…) es presentación y no pasa.
 *
 * LÍMITE DOCUMENTADO: una expresión dinámica no se evalúa. `className={clases}` (una variable, una llamada, una propiedad) no se puede mirar con el AST; solo se miran los literales que están
 * escritos DENTRO del atributo. Quien arma una cadena fuera del JSX y la pasa a una primitiva no la pasa por esta regla.
 */

/** Las clases de ubicación y tamaño que una primitiva deja pasar (el token sin variantes). */
const RE_ADMITIDAS = /^(?:-?m[xytrblse]?-\S+|w-\S+|min-w-\S+|max-w-\S+|self-\S+|justify-self-\S+|col-span-\S+|col-start-\S+|row-span-\S+|order-\S+|basis-\S+|hidden|block|flex-1|grow|shrink-0)$/;
const VARIANTES_ADMITIDAS = new Set(["sm", "md", "lg", "xl", "max-sm", "max-md", "max-lg"]);

interface Violacion {
  /** El nombre del elemento tal como está escrito (`Boton`, `Ui.Boton`). */
  elemento: string;
  /** El token completo, con sus variantes. */
  token: string;
  linea: number;
}

/** Las variantes de un token (`sm:hover:bg-x` → `["sm", "hover"]`): lo que va antes de cada `:` que no está entre corchetes o paréntesis. */
function variantesDe(token: string): string[] {
  const variantes: string[] = [];
  let profundidad = 0;
  let inicio = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[" || c === "(") profundidad++;
    else if (c === "]" || c === ")") profundidad = Math.max(0, profundidad - 1);
    else if (c === ":" && profundidad === 0) {
      variantes.push(token.slice(inicio, i));
      inicio = i + 1;
    }
  }
  return variantes;
}

/** Un token de clase es de ubicación o tamaño: su base está en la lista y todas sus variantes son de ancho de pantalla. */
function esDeUbicacion(token: string): boolean {
  return RE_ADMITIDAS.test(sinVariantes(token)) && variantesDe(token).every((v) => VARIANTES_ADMITIDAS.has(v));
}

/** Los literales de texto escritos dentro de una expresión (un string, una plantilla sin sustituciones, las partes fijas de una plantilla con `${…}`, las ramas de un condicional…). */
function literalesDe(nodo: ts.Node, salida: string[]): void {
  if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) {
    salida.push(nodo.text);
    return;
  }
  if (ts.isTemplateExpression(nodo)) {
    salida.push(nodo.head.text);
    for (const s of nodo.templateSpans) {
      salida.push(s.literal.text);
      literalesDe(s.expression, salida);
    }
    return;
  }
  ts.forEachChild(nodo, (hijo) => literalesDe(hijo, salida));
}

/** Lo que `@/ui/…` importa, por nombre local: `Boton`, un alias (`import { Boton as B }`), el por defecto o el espacio de nombres (`import * as Ui`). */
function importadosDeUi(arbol: ts.SourceFile): Set<string> {
  const nombres = new Set<string>();
  for (const sentencia of arbol.statements) {
    if (!ts.isImportDeclaration(sentencia) || !ts.isStringLiteral(sentencia.moduleSpecifier)) continue;
    const modulo = sentencia.moduleSpecifier.text;
    if (modulo !== "@/ui" && !modulo.startsWith("@/ui/")) continue;
    const clausula = sentencia.importClause;
    if (!clausula) continue;
    if (clausula.name) nombres.add(clausula.name.text);
    const enlaces = clausula.namedBindings;
    if (enlaces && ts.isNamespaceImport(enlaces)) nombres.add(enlaces.name.text);
    else if (enlaces) for (const e of enlaces.elements) nombres.add(e.name.text);
  }
  return nombres;
}

/** El identificador de la raíz de un nombre de etiqueta (`Ui.Boton` → `Ui`). `this.x` y las etiquetas con `:` no tienen raíz importada. */
function raizDeEtiqueta(etiqueta: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(etiqueta)) return etiqueta.text;
  if (ts.isPropertyAccessExpression(etiqueta)) return raizDeEtiqueta(etiqueta.expression as ts.JsxTagNameExpression);
  return null;
}

/** Cada clase de presentación que un elemento importado de `@/ui/…` recibe por `className` literal en `fuente`. */
function violacionesDe(fuente: string, ruta: string): Violacion[] {
  const arbol = arbolDe(fuente, ruta);
  const importados = importadosDeUi(arbol);
  const salida: Violacion[] = [];
  if (importados.size === 0) return salida;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) {
      const raiz = raizDeEtiqueta(nodo.tagName);
      if (raiz !== null && importados.has(raiz)) {
        for (const atributo of nodo.attributes.properties) {
          if (!ts.isJsxAttribute(atributo) || atributo.name.getText(arbol) !== "className" || !atributo.initializer) continue;
          const literales: string[] = [];
          literalesDe(atributo.initializer, literales);
          for (const literal of literales) {
            for (const token of literal.match(/\S+/g) ?? []) {
              if (!esDeUbicacion(token)) {
                salida.push({ elemento: nodo.tagName.getText(arbol), token, linea: arbol.getLineAndCharacterOfPosition(atributo.getStart(arbol)).line + 1 });
              }
            }
          }
        }
      }
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);
  return salida;
}

describe("regla «primitivas sin clases de presentación»: el detector", () => {
  const importar = 'import { Boton } from "@/ui/primitivas/boton";\n';

  it("una clase de color sobre una primitiva es una violación (la fixture de la mutación)", () => {
    const fuente = `${importar}export const F = () => <Boton className="bg-red-700">x</Boton>;`;
    expect(violacionesDe(fuente, "x.tsx")).toEqual([{ elemento: "Boton", token: "bg-red-700", linea: 2 }]);
  });

  it("admite la ubicación y el tamaño (márgenes, anchos, grilla, visibilidad), también con variantes de ancho de pantalla", () => {
    const clases = "mt-2 -mx-1 ms-auto w-full min-w-0 max-w-sm basis-1/2 self-end justify-self-start col-span-2 col-start-1 row-span-2 order-last hidden block flex-1 grow shrink-0 md:w-1/2 max-sm:hidden sm:mt-4 lg:max-w-md";
    const fuente = `${importar}export const F = () => <Boton className="${clases}">x</Boton>;`;
    expect(violacionesDe(fuente, "x.tsx")).toEqual([]);
  });

  it("no admite una clase de presentación ni una variante que no sea de ancho de pantalla, aunque la base sea de ubicación", () => {
    const fuente = `${importar}export const F = () => <Boton className="mt-2 hover:w-full dark:block text-sm font-bold rounded min-h-11 p-2 shadow">x</Boton>;`;
    expect(violacionesDe(fuente, "x.tsx").map((v) => v.token)).toEqual(["hover:w-full", "dark:block", "text-sm", "font-bold", "rounded", "min-h-11", "p-2", "shadow"]);
  });

  it("mira las partes fijas de una plantilla y las ramas de un condicional, y no evalúa una expresión dinámica", () => {
    const plantilla = `${importar}export const F = ({ x }: { x: boolean }) => <Boton className={\`mt-2 text-lg \${x ? "w-full" : "bg-red-700"}\`}>x</Boton>;`;
    expect(violacionesDe(plantilla, "x.tsx").map((v) => v.token)).toEqual(["text-lg", "bg-red-700"]);
    const dinamica = `${importar}const clases = "bg-red-700";\nexport const F = () => <Boton className={clases}>x</Boton>;`;
    expect(violacionesDe(dinamica, "x.tsx")).toEqual([]);
  });

  it("mira el nombre con alias, el por defecto y el espacio de nombres; no un elemento que no se importa de @/ui ni un elemento nativo", () => {
    const alias = 'import { Aviso as A } from "@/ui/primitivas/aviso";\nexport const F = () => <A variante="error" className="p-4">x</A>;';
    expect(violacionesDe(alias, "x.tsx")).toEqual([{ elemento: "A", token: "p-4", linea: 2 }]);
    const porDefecto = 'import Tabla from "@/ui/componentes/datos/tabla";\nexport const F = () => <Tabla className="border" />;';
    expect(violacionesDe(porDefecto, "x.tsx")).toHaveLength(1);
    const espacio = 'import * as Ui from "@/ui/primitivas/boton";\nexport const F = () => <Ui.Boton className="border">x</Ui.Boton>;';
    expect(violacionesDe(espacio, "x.tsx")).toEqual([{ elemento: "Ui.Boton", token: "border", linea: 2 }]);
    const ajeno = 'import Link from "next/link";\nimport { Otro } from "@/components/otro";\nexport const F = () => <><Link className="border" /><Otro className="border" /><p className="border" /></>;';
    expect(violacionesDe(ajeno, "x.tsx")).toEqual([]);
  });

  it("no cuenta un comentario ni un className de otro atributo, y sí el de un elemento con hijos", () => {
    const fuente = `${importar}export const F = () => <Boton title="bg-red-700" aria-label={"border"}>{/* className="bg-red-700" */}x</Boton>;`;
    expect(violacionesDe(fuente, "x.tsx")).toEqual([]);
  });
});

describe("regla «primitivas sin clases de presentación»: el repo", () => {
  it("ningún .tsx de src/app ni de src/components le pasa clases de presentación a una primitiva de @/ui", () => {
    const hallazgos: string[] = [];
    for (const ruta of listarArchivos(RAIZ_DEL_REPO, ["src/app", "src/components"], [".tsx"])) {
      for (const v of violacionesDe(leer(RAIZ_DEL_REPO, ruta), ruta)) hallazgos.push(`${ruta}:${v.linea}  <${v.elemento} className="… ${v.token} …">`);
    }
    expect(
      hallazgos,
      `Una primitiva de src/ui no recibe clases de color, borde, tipografía ni relleno: se elige una variante, o se pide una variante nueva en la primitiva (solo se admite ubicación y tamaño: márgenes, ancho, grilla, visibilidad).\n${hallazgos.join("\n")}`,
    ).toEqual([]);
  });
});
