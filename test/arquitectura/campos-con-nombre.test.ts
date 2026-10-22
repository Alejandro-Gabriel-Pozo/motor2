import ts from "typescript";
import { describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO, arbolDe, leer, listarArchivos } from "./cercos/trinquete";

/**
 * Regla dura «campos con nombre» (Fase 6, paso 6.8.7a; base 0, sin línea de base). Un campo sin nombre accesible no existe para un lector de pantalla: el `<input>` se anuncia solo como «cuadro
 * de edición». Los dos campos que NO dibujan su propia etiqueta tienen que estar nombrados por alguien más, y esta regla verifica que lo estén:
 *  - `<CampoNumero …>` (src/components/campo-numero.tsx): no dibuja etiqueta (su `etiqueta` es el sujeto del mensaje de error, no un rótulo);
 *  - `<Campo nombradoPorFuera …>` (src/ui/primitivas/campo.tsx): la forma de `Campo` que le dice a la primitiva que el nombre lo pone otro.
 *
 * Qué mira: el AST de los `.tsx` de `src/app` y `src/components`. Cada uno de esos dos elementos, escrito como JSX literal, tiene que cumplir UNA de tres cosas (en el MISMO archivo):
 *  1. lleva `ariaLabel` (el de `CampoNumero`) o `aria-label` (el de `Campo`);
 *  2. lleva un `id` cuyo texto coincide con el de un `htmlFor` del archivo (`id="x"` y `<label htmlFor="x">`, o la misma expresión `` `${base}-cantidad` `` en las dos);
 *  3. tiene un `<label>` como ANCESTRO JSX (el `<label>` envuelve al campo, así que el campo es el control de esa etiqueta).
 *
 * LÍMITE DOCUMENTADO: se mira un solo archivo. Un `id` que se ata a un `<label htmlFor>` de OTRO archivo, un `aria-labelledby`, o un campo que recibe el nombre por un `{...props}` no se pueden
 * verificar con el AST de un archivo: quien los necesite escribe `ariaLabel` (que es lo que esta regla acepta sin condiciones). Un `<label>` con el mismo `htmlFor` que el `id` pero que no
 * está en pantalla (renderizado por una condición) tampoco se evalúa.
 */

/** Los elementos que tienen que estar nombrados, y cómo se reconoce cada uno: por su etiqueta, y (Campo) solo cuando lleva `nombradoPorFuera`. */
const ELEMENTOS_VIGILADOS = new Set(["CampoNumero", "Campo"]);
const ATRIBUTOS_DE_NOMBRE = new Set(["ariaLabel", "aria-label"]);

interface Hallazgo {
  /** El nombre del elemento tal como está escrito (`CampoNumero`, `Campo`). */
  elemento: string;
  linea: number;
}

type ElementoJsx = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

const atributoDe = (elemento: ElementoJsx, nombre: string | ReadonlySet<string>): ts.JsxAttribute | undefined =>
  elemento.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && (typeof nombre === "string" ? a.name.getText() === nombre : nombre.has(a.name.getText())));

/** El texto de un atributo para compararlo: el valor de un string, o el código de una expresión (`` `${base}-cantidad` ``). `null` si no hay nada que comparar. */
function textoDelAtributo(atributo: ts.JsxAttribute, arbol: ts.SourceFile): string | null {
  const inicio = atributo.initializer;
  if (!inicio) return null;
  if (ts.isStringLiteral(inicio)) return inicio.text;
  if (!ts.isJsxExpression(inicio) || !inicio.expression) return null;
  const expresion = inicio.expression;
  if (ts.isStringLiteral(expresion) || ts.isNoSubstitutionTemplateLiteral(expresion)) return expresion.text;
  return expresion.getText(arbol);
}

/** ¿Algún ancestro JSX de `nodo` es un `<label>`? */
function dentroDeUnLabel(nodo: ts.Node): boolean {
  for (let padre: ts.Node | undefined = nodo.parent; padre; padre = padre.parent) {
    if (ts.isJsxElement(padre) && padre.openingElement.tagName.getText() === "label") return true;
  }
  return false;
}

/** Cada `<CampoNumero>` y cada `<Campo nombradoPorFuera>` de `fuente` que no cumple ninguna de las tres formas de tener nombre. */
function camposSinNombre(fuente: string, ruta: string): Hallazgo[] {
  const arbol = arbolDe(fuente, ruta);
  const elementos: ElementoJsx[] = [];
  const paraFor = new Set<string>();
  const visitar = (nodo: ts.Node): void => {
    if (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) {
      for (const a of nodo.attributes.properties) {
        if (ts.isJsxAttribute(a) && a.name.getText() === "htmlFor") {
          const texto = textoDelAtributo(a, arbol);
          if (texto !== null) paraFor.add(texto);
        }
      }
      const nombre = nodo.tagName.getText();
      if (ELEMENTOS_VIGILADOS.has(nombre) && (nombre === "CampoNumero" || atributoDe(nodo, "nombradoPorFuera") !== undefined)) elementos.push(nodo);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbol);

  const salida: Hallazgo[] = [];
  for (const elemento of elementos) {
    if (atributoDe(elemento, ATRIBUTOS_DE_NOMBRE) !== undefined) continue;
    const id = atributoDe(elemento, "id");
    const textoDelId = id ? textoDelAtributo(id, arbol) : null;
    if (textoDelId !== null && paraFor.has(textoDelId)) continue;
    if (dentroDeUnLabel(elemento)) continue;
    salida.push({ elemento: elemento.tagName.getText(), linea: arbol.getLineAndCharacterOfPosition(elemento.getStart(arbol)).line + 1 });
  }
  return salida;
}

describe("regla «campos con nombre»: el detector", () => {
  const importar = 'import { CampoNumero } from "@/components/campo-numero";\n';

  it("un CampoNumero suelto (sin aria-label, sin label que lo ate ni que lo envuelva) es un hallazgo (la fixture de la mutación)", () => {
    const fuente = `${importar}export const F = () => <div><CampoNumero name="cantidad" /></div>;`;
    expect(camposSinNombre(fuente, "x.tsx")).toEqual([{ elemento: "CampoNumero", linea: 2 }]);
  });

  it("con ariaLabel está nombrado", () => {
    const fuente = `${importar}export const F = () => <CampoNumero name="cantidad" ariaLabel="Cantidad" />;`;
    expect(camposSinNombre(fuente, "x.tsx")).toEqual([]);
  });

  it("dentro de un <label> (en cualquier nivel) está nombrado", () => {
    const directo = `${importar}export const F = () => <label>Cantidad <CampoNumero name="c" /></label>;`;
    expect(camposSinNombre(directo, "x.tsx")).toEqual([]);
    const anidado = `${importar}export const F = () => <label><span>Cantidad</span><div><CampoNumero name="c" /></div></label>;`;
    expect(camposSinNombre(anidado, "x.tsx")).toEqual([]);
    // Un <label> que es HERMANO del campo no lo envuelve: sin htmlFor, no lo nombra.
    const hermano = `${importar}export const F = () => <div><label>Cantidad</label><CampoNumero name="c" /></div>;`;
    expect(camposSinNombre(hermano, "x.tsx")).toEqual([{ elemento: "CampoNumero", linea: 2 }]);
  });

  it("con un id que coincide con el htmlFor de un <label> del archivo está nombrado (string o la misma expresión)", () => {
    const texto = `${importar}export const F = () => <div><label htmlFor="cantidad-x">Cantidad</label><CampoNumero id="cantidad-x" name="c" /></div>;`;
    expect(camposSinNombre(texto, "x.tsx")).toEqual([]);
    const expresion = `${importar}export const F = ({ base }: { base: string }) => <div><label htmlFor={\`\${base}-cantidad\`}>Cantidad</label><CampoNumero id={\`\${base}-cantidad\`} name="c" /></div>;`;
    expect(camposSinNombre(expresion, "x.tsx")).toEqual([]);
    const mezcla = `${importar}export const F = () => <div><label htmlFor={"cantidad-x"}>Cantidad</label><CampoNumero id="cantidad-x" name="c" /></div>;`;
    expect(camposSinNombre(mezcla, "x.tsx")).toEqual([]);
  });

  it("un id que no coincide con ningún htmlFor, o un htmlFor sin id en el campo, no lo nombra", () => {
    const otroId = `${importar}export const F = () => <div><label htmlFor="uno">A</label><CampoNumero id="dos" name="c" /></div>;`;
    expect(camposSinNombre(otroId, "x.tsx")).toEqual([{ elemento: "CampoNumero", linea: 2 }]);
    const sinId = `${importar}export const F = () => <div><label htmlFor="uno">A</label><CampoNumero name="c" /></div>;`;
    expect(camposSinNombre(sinId, "x.tsx")).toEqual([{ elemento: "CampoNumero", linea: 2 }]);
    const otraExpresion = `${importar}export const F = ({ a, b }: { a: string; b: string }) => <div><label htmlFor={a}>A</label><CampoNumero id={b} name="c" /></div>;`;
    expect(camposSinNombre(otraExpresion, "x.tsx")).toHaveLength(1);
  });

  it("<Campo nombradoPorFuera> se vigila igual que CampoNumero; <Campo etiqueta> y <Campo aria-label> no hacen falta", () => {
    const suelto = 'import { Campo } from "@/ui/primitivas/campo";\nexport const F = () => <Campo nombradoPorFuera name="c" />;';
    expect(camposSinNombre(suelto, "x.tsx")).toEqual([{ elemento: "Campo", linea: 2 }]);
    const conAria = 'import { Campo } from "@/ui/primitivas/campo";\nexport const F = () => <Campo nombradoPorFuera aria-label="Cantidad" name="c" />;';
    expect(camposSinNombre(conAria, "x.tsx")).toEqual([]);
    const envuelto = 'import { Campo } from "@/ui/primitivas/campo";\nexport const F = () => <label>Cantidad<Campo nombradoPorFuera name="c" /></label>;';
    expect(camposSinNombre(envuelto, "x.tsx")).toEqual([]);
    const conEtiqueta = 'import { Campo } from "@/ui/primitivas/campo";\nexport const F = () => <Campo etiqueta="Cantidad" name="c" />;';
    expect(camposSinNombre(conEtiqueta, "x.tsx")).toEqual([]);
  });

  it("mira los elementos con hijos y los de varias líneas, con la línea donde empiezan, y no cuenta un comentario ni un texto", () => {
    const fuente = [
      importar.trim(),
      "export const F = () => (",
      "  <div>",
      "    <CampoNumero",
      '      name="c"',
      "    />",
      "    {/* <CampoNumero name=\"x\" /> */}",
      "    <p>{'<CampoNumero name=\"y\" />'}</p>",
      "  </div>",
      ");",
    ].join("\n");
    expect(camposSinNombre(fuente, "x.tsx")).toEqual([{ elemento: "CampoNumero", linea: 4 }]);
  });
});

describe("regla «campos con nombre»: el repo", () => {
  it("todo <CampoNumero> y todo <Campo nombradoPorFuera> de src/app y src/components está nombrado (ariaLabel, id atado a un htmlFor o dentro de un <label>)", () => {
    const hallazgos: string[] = [];
    for (const ruta of listarArchivos(RAIZ_DEL_REPO, ["src/app", "src/components"], [".tsx"])) {
      for (const h of camposSinNombre(leer(RAIZ_DEL_REPO, ruta), ruta)) hallazgos.push(`${ruta}:${h.linea}  <${h.elemento}> sin nombre accesible`);
    }
    expect(
      hallazgos,
      `Un campo sin nombre no existe para un lector de pantalla. Dale \`ariaLabel\` (el patrón de receta-de-la-sucursal.tsx), atalo con un \`id\` a un \`<label htmlFor>\` del mismo archivo, o ponelo dentro de un \`<label>\`.\n${hallazgos.join("\n")}`,
    ).toEqual([]);
  });
});
