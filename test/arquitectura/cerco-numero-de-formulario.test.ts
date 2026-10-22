import ts from "typescript";
import { describe, expect, it } from "vitest";
import { arbolDe, medirPorArchivo, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «número de un formulario leído a mano» (lote 6.33, «tipos de dato declarados y bloqueantes»): lo que una persona teclea en un campo numérico se lee con `numeroDelCampo` (`src/core/datos/numero-tecleado.ts`:
 * vacío → `undefined`, número → el número, cualquier otra cosa → `NaN`, nunca 0) y el servidor lo vuelve a validar con el parser del tipo (`validarImporte`, `validarCantidad`). `Number(formData.get("x"))` lee un
 * campo vacío como 0 (`Number("")`), acepta `0x10`, `1e3` y `Infinity`, y no sabe de la coma decimal. Cuenta, por archivo, las llamadas a `Number(…)`, `parseFloat(…)` y `parseInt(…)` cuyo argumento contiene una
 * lectura `formData.get(…)` (el receptor se llama `formData`, `fd`, `form`, `datos` o termina en `FormData`) en `src/` y en `plataforma/src/`. Mira el AST: un comentario o un string no cuentan.
 * Meta: 0, ALCANZADA en el lote 6.33 (recetas y rendimiento pasaron a `numeroDelCampo`): la línea de base queda en 0 y el cerco cuida que no vuelva.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const CONVERSORES = new Set(["Number", "parseFloat", "parseInt"]);
const RECEPTOR = /^(?:formData|fd|form|datos)$|FormData$/;

function leeUnFormulario(nodo: ts.Node): boolean {
  if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression) && nodo.expression.name.text === "get" && ts.isIdentifier(nodo.expression.expression) && RECEPTOR.test(nodo.expression.expression.text)) return true;
  return ts.forEachChild(nodo, leeUnFormulario) ?? false;
}

function contarNumerosDeFormulario(fuente: string, ruta: string): Record<string, number> {
  const cuenta: Record<string, number> = { "numero-de-formulario": 0 };
  const visitar = (nodo: ts.Node): void => {
    if (ts.isCallExpression(nodo) && ts.isIdentifier(nodo.expression) && CONVERSORES.has(nodo.expression.text) && nodo.arguments.some(leeUnFormulario)) cuenta["numero-de-formulario"]++;
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbolDe(fuente, ruta));
  return cuenta;
}

const CERCO_NUMERO_DE_FORMULARIO: Cerco = {
  regla: "numero-de-formulario-a-mano",
  meta: "0 (lote 6.33: todo número de un formulario se lee con numeroDelCampo y el parser de su tipo)",
  medir: medirPorArchivo({ raices: ["src", "plataforma/src"], extensiones: [".ts", ".tsx"], contar: contarNumerosDeFormulario }),
};

describe("cerco «número de un formulario a mano»: el detector", () => {
  it("cuenta Number, parseFloat y parseInt sobre una lectura de formulario, también dentro de una expresión", () => {
    const fuente = [
      "export function f(formData: FormData, fd: FormData, f2: FormData) {",
      '  const a = Number(formData.get("a"));',
      '  const b = Number(formData.get("b") || 0);',
      '  const c = parseFloat(String(fd.get("c")));',
      '  const d = formData.get("d") ? parseInt(formData.get("d") as string, 10) : undefined;',
      '  const e = Number(f2.get("e"));',
      "}",
    ].join("\n");
    expect(contarNumerosDeFormulario(fuente, "x.ts")).toEqual({ "numero-de-formulario": 4 });
  });

  it("no cuenta el texto sin convertir, un Number de otra cosa, un mapa cualquiera ni un comentario", () => {
    const fuente = [
      "export function f(formData: FormData, mapa: Map<string, number>) {",
      '  const a = formData.get("a");',
      "  const b = Number(mapa.get(1));",
      '  const c = numeroDelCampo(String(formData.get("c")));',
      '  // Number(formData.get("x"))',
      '  return `${a}${b}${c}Number(formData.get("x"))`;',
      "}",
    ].join("\n");
    expect(contarNumerosDeFormulario(fuente, "x.ts")).toEqual({ "numero-de-formulario": 0 });
  });
});

probarCerco(CERCO_NUMERO_DE_FORMULARIO);
