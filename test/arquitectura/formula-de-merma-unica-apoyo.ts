import ts from "typescript";
import { arbolDe } from "./cercos/trinquete";

/**
 * Detector del cerco `formula-de-merma-unica` (M0 de `docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md`): cuenta, en el AST, la fórmula del factor de merma ESCRITA A MANO en vez de llamar a
 * `factorDeMerma` / `factorDeMermaExacto` (`src/core/catalogo/merma.ts`). Dos formas:
 *  1. `number`: una suma de la constante 1 con una división por la constante 100 cuyo dividendo nombra la merma: `1 + ef.mermaPorcentaje / 100`, `1 + (merma / 100)`, `merma / 100 + 1`.
 *  2. decimal exacto: `new D(1).plus(<algo con «merma» y dividedBy(100) o div(100)>)`.
 *
 * LÍMITES (honestos; es una alarma para errores honestos, no un límite de seguridad):
 *  - El dividendo tiene que NOMBRAR la merma (`merma`, `Merma`, `mermaPorcentaje`…). Con otro nombre (`1 + m / 100`, `1 + p / 100`) no se ve. Ejemplo: `const f = 1 + m / 100;`.
 *  - Una constante en vez del literal no se ve: `const CIEN = 100; 1 + merma / CIEN`.
 *  - Reescribir el factor con otra forma algebraica no se ve: `(100 + merma) / 100`, `merma * 0.01 + 1`.
 *  - La fórmula del NETO (`bruto × (100 − merma) / 100`, de las etapas M2 y M3) NO está cubierta todavía: se agrega con el módulo de neto.
 */

const NOMBRA_MERMA = /merma/i;

const sinParentesis = (nodo: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(nodo) ? sinParentesis(nodo.expression) : nodo);

function esLiteral(nodo: ts.Expression, valor: string): boolean {
  const n = sinParentesis(nodo);
  return ts.isNumericLiteral(n) && Number(n.text) === Number(valor);
}

/** `<algo con merma> / 100` */
function esMermaSobreCien(nodo: ts.Expression): boolean {
  const n = sinParentesis(nodo);
  return ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.SlashToken && esLiteral(n.right, "100") && NOMBRA_MERMA.test(n.left.getText());
}

/** `new X(1)` o `X(1)`: la constante 1 como decimal. */
function esUnoDecimal(nodo: ts.Expression): boolean {
  const n = sinParentesis(nodo);
  return (ts.isNewExpression(n) || ts.isCallExpression(n)) && (n.arguments?.length ?? 0) === 1 && esLiteral(n.arguments![0]!, "1");
}

/** `<algo>.dividedBy(100)` o `<algo>.div(100)` con la merma adentro. */
function esMermaDecimalSobreCien(nodo: ts.Expression): boolean {
  const n = sinParentesis(nodo);
  return (
    ts.isCallExpression(n) &&
    ts.isPropertyAccessExpression(n.expression) &&
    (n.expression.name.text === "dividedBy" || n.expression.name.text === "div") &&
    n.arguments.length === 1 &&
    esLiteral(n.arguments[0]!, "100") &&
    NOMBRA_MERMA.test(n.expression.expression.getText())
  );
}

export function contarFormulaDeMermaAMano(fuente: string, ruta: string): number {
  let cuenta = 0;
  const visitar = (nodo: ts.Node): void => {
    if (ts.isBinaryExpression(nodo) && nodo.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      if ((esLiteral(nodo.left, "1") && esMermaSobreCien(nodo.right)) || (esLiteral(nodo.right, "1") && esMermaSobreCien(nodo.left))) cuenta++;
    }
    if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression) && nodo.expression.name.text === "plus" && nodo.arguments.length === 1) {
      if (esUnoDecimal(nodo.expression.expression) && esMermaDecimalSobreCien(nodo.arguments[0]!)) cuenta++;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbolDe(fuente, ruta));
  return cuenta;
}
