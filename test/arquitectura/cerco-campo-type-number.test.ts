import ts from "typescript";
import { describe, expect, it } from "vitest";
import { arbolDe, medirPorArchivo, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «campo type="number"» (lote 6.33, «tipos de dato declarados y bloqueantes»): un número que escribe una persona se declara con su TIPO (`CampoNumero tipo="importe" | "cantidad" | "entero" | "porcentaje"`),
 * que lo lee con la notación argentina, lo valida con la misma regla que la Server Action y no deja pasar lo que no es un número. `<input type="number">` (o `<Campo type="number">`) no hace nada de eso: acepta la
 * notación del navegador, «1,5» según el idioma, `e` y flechitas de spinner. Cuenta, por archivo, los `<input>` y `<Campo>` con `type="number"` escritos FUERA de `src/ui/` (en `src/` y en la consola,
 * `plataforma/src/`). Mira el AST: un comentario, un string o el `type="number"` del eje de un gráfico (`<XAxis type="number">`) no cuentan.
 * Meta: 0 (cada uno pasa a `CampoNumero` con su tipo). Hoy es deuda declarada, con su motivo por archivo.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const ELEMENTOS = new Set(["input", "Campo"]);

function esTypeNumber(atributos: ts.JsxAttributes): boolean {
  return atributos.properties.some((a) => {
    if (!ts.isJsxAttribute(a) || a.name.getText() !== "type" || !a.initializer) return false;
    const valor = ts.isStringLiteral(a.initializer) ? a.initializer : ts.isJsxExpression(a.initializer) && a.initializer.expression && ts.isStringLiteral(a.initializer.expression) ? a.initializer.expression : null;
    return valor?.text === "number";
  });
}

function contarTypeNumber(fuente: string, ruta: string): Record<string, number> {
  const cuenta: Record<string, number> = { "type-number": 0 };
  const visitar = (nodo: ts.Node): void => {
    if ((ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) && ts.isIdentifier(nodo.tagName) && ELEMENTOS.has(nodo.tagName.text) && esTypeNumber(nodo.attributes)) cuenta["type-number"]++;
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbolDe(fuente, ruta));
  return cuenta;
}

const A_ENTERO = (donde: string) => `${donde}: un número entero escrito con \`type="number"\`; pasa a \`CampoNumero tipo="entero"\` (el parser argentino y la validación del tipo, no la notación del navegador).`;
const A_PORCENTAJE = (donde: string) => `${donde}: un porcentaje escrito con \`type="number"\`; pasa a \`CampoNumero tipo="porcentaje"\`.`;

const CERCO_TYPE_NUMBER: Cerco = {
  regla: "campo-type-number",
  meta: "0 (lote 6.33: todo número tecleado es un CampoNumero con su tipo declarado)",
  medir: medirPorArchivo({ raices: ["src", "plataforma/src"], extensiones: [".tsx", ".jsx"], incluir: (ruta) => !ruta.startsWith("src/ui/"), contar: contarTypeNumber }),
  motivos: {
    "src/app/(app)/carta/agrupados/page.tsx": A_ENTERO("El orden de un agrupado de la carta"),
    "src/app/(app)/carta/parametrizacion/formularios.tsx": A_ENTERO("Orden, mínimos y máximos de los lugares de la carta") + " Incluye el precio de un ítem (importe).",
    "src/app/(app)/carta/portal/page.tsx": A_ENTERO("El orden en el portal") + " Incluye los porcentajes del portal (porcentaje).",
    "src/app/(app)/catalogo/unidades/page.tsx": A_ENTERO("Los decimales de una unidad (0 a 6)"),
    "src/app/(app)/reportes/devoluciones/page.tsx": A_ENTERO("«Días atrás» del reporte"),
    "src/app/(app)/reportes/perdidas/page.tsx": A_ENTERO("«Días atrás» del reporte"),
    "src/app/(app)/reportes/vencimientos/page.tsx": A_ENTERO("«Próximos (días)» del reporte"),
    "src/components/carta/contenido-del-producto.tsx": A_PORCENTAJE("El descuento en esta sucursal"),
    "src/components/carta/editor-portal.tsx": A_PORCENTAJE("Porcentajes y opacidad del editor del portal"),
    "src/components/carta/editor-tema.tsx": A_PORCENTAJE("Porcentajes y topes del editor del tema"),
    "src/components/carta/seccion-y-orden.tsx": A_ENTERO("El orden de una sección dentro de la carta"),
  },
};

describe("cerco «campo type=number»: el detector", () => {
  it("cuenta <input> y <Campo> con type=\"number\" (literal o entre llaves), con hijos o autocerrado", () => {
    const fuente = [
      "export const F = () => (",
      "  <form>",
      '    <input type="number" name="a" />',
      '    <Campo etiqueta="x" type={"number"} />',
      '    <Campo etiqueta="y" type="number"></Campo>',
      "  </form>",
      ");",
    ].join("\n");
    expect(contarTypeNumber(fuente, "x.tsx")).toEqual({ "type-number": 3 });
  });

  it("no cuenta otros tipos, el eje de un gráfico, un comentario ni un string", () => {
    const fuente = 'export const F = () => <><input type="text" /><Campo type="date" /><XAxis type="number" />{/* <input type="number" /> */}<p>{\'<input type="number">\'}</p></>;';
    expect(contarTypeNumber(fuente, "x.tsx")).toEqual({ "type-number": 0 });
  });
});

probarCerco(CERCO_TYPE_NUMBER);
