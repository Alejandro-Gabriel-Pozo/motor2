import ts from "typescript";
import { describe, expect, it } from "vitest";
import { arbolDe, medirPorArchivo, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «controles a mano» (ola «precio y carta», Fase 1; inventario de pantallas y primitivas §2 y auditoría §18.4): `src/ui/` tiene
 * las primitivas (`Boton`, `Campo`, `Dialogo`…) y casi nadie las usa. Cuenta, por archivo y por tipo, los elementos JSX nativos
 * `<button>`, `<input>`, `<select>` y `<textarea>` escritos FUERA de `src/ui/` (en `src/` y en la consola, `plataforma/src/`). Mira el AST
 * (los elementos de verdad), no el texto: un comentario o un string que diga `<button` no cuenta.
 *
 * `<input type="hidden">` va en su propio tipo (`input-hidden`): no es un control que se vea ni que una primitiva vaya a reemplazar
 * (lleva un dato del formulario), así que no se mezcla con los `input` visibles; igual queda congelado para que no crezca sin control.
 * Meta: bajar a medida que las pantallas pasan a las primitivas (Fase 6).
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const CONTROLES = new Set(["button", "input", "select", "textarea"]);

function esInputOculto(atributos: ts.JsxAttributes): boolean {
  return atributos.properties.some((a) => {
    if (!ts.isJsxAttribute(a) || a.name.getText() !== "type" || !a.initializer) return false;
    const valor = ts.isStringLiteral(a.initializer) ? a.initializer : ts.isJsxExpression(a.initializer) && a.initializer.expression && ts.isStringLiteral(a.initializer.expression) ? a.initializer.expression : null;
    return valor?.text === "hidden";
  });
}

function contarControles(fuente: string, ruta: string): Record<string, number> {
  const cuenta: Record<string, number> = { button: 0, input: 0, "input-hidden": 0, select: 0, textarea: 0 };
  const visitar = (nodo: ts.Node): void => {
    if ((ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) && ts.isIdentifier(nodo.tagName) && CONTROLES.has(nodo.tagName.text)) {
      const tipo = nodo.tagName.text === "input" && esInputOculto(nodo.attributes) ? "input-hidden" : nodo.tagName.text;
      cuenta[tipo]++;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbolDe(fuente, ruta));
  return cuenta;
}

const CERCO_CONTROLES: Cerco = {
  regla: "controles-a-mano",
  meta: "bajar hacia 0 en la Fase 6: botones, campos, selectores y áreas de texto salen de las primitivas de src/ui",
  medir: medirPorArchivo({ raices: ["src", "plataforma/src"], extensiones: [".tsx", ".jsx"], incluir: (ruta) => !ruta.startsWith("src/ui/"), contar: contarControles }),
  excepciones: [
    { ruta: "src/app/global-error.tsx", motivo: "Último recurso: reemplaza al layout raíz y no carga `globals.css`, así que una primitiva (que se viste con clases de tokens) saldría sin estilo; su botón lleva estilos en línea." },
    { ruta: "src/app/(carta-publica)/error.tsx", motivo: "Pantalla de error de la carta del cliente: el botón se pinta con la tinta del TEMA del cliente (`--carta-ink`), que ninguna variante de `Boton` (tokens de la interfaz) sabe usar." },
    { ruta: "src/components/carta-publica/carta-vista.tsx", motivo: "Carta del cliente: la fila del índice es un botón cuya tipografía, colores y bordes vienen del tema (`--carta-*` y `estilo.valores`), no de los tokens de la interfaz." },
    { ruta: "src/components/carta-publica/navegacion-carta.tsx", motivo: "Carta del cliente: las flechas, la píldora «Índice» y el ícono de imprimir se pintan con las variables del tema (`--carta-primary`, `--carta-flechas`), no con los tokens de la interfaz." },
  ],
};

describe("cerco «controles a mano»: el detector", () => {
  it("cuenta cada elemento nativo (con hijos o autocerrado) y aparta el input oculto", () => {
    const fuente = [
      "export const F = () => (",
      "  <form>",
      '    <input type="hidden" name="id" value="1" />',
      '    <input type={"hidden"} name="v" />',
      '    <input name="nombre" className="border" />',
      '    <select name="s"><option>a</option></select>',
      "    <textarea name='t' />",
      '    <button type="submit">Guardar</button>',
      "    <Boton>Primitiva</Boton>",
      "  </form>",
      ");",
    ].join("\n");
    expect(contarControles(fuente, "x.tsx")).toEqual({ button: 1, input: 1, "input-hidden": 2, select: 1, textarea: 1 });
  });

  it("no cuenta un componente con nombre parecido, un comentario ni un string", () => {
    const fuente = 'export const F = () => <><Button /><Campo.input />{/* <button> */}<p>{"<button>"}</p></>;';
    expect(contarControles(fuente, "x.tsx")).toEqual({ button: 0, input: 0, "input-hidden": 0, select: 0, textarea: 0 });
  });
});

probarCerco(CERCO_CONTROLES);
