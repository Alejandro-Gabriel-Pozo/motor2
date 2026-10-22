import ts from "typescript";
import { describe, expect, it } from "vitest";
import { arbolDe, medirPorArchivo, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «teclado numérico a mano» (lote 6.33, «tipos de dato declarados y bloqueantes»): pedir el teclado de números con `inputMode="numeric"` o `inputMode="decimal"` en un `<input>` o un `<Campo>` es declarar «acá va un
 * número» sin que nada lo lea ni lo valide: el campo acepta cualquier texto, el parser argentino no interviene y el servidor recibe lo que sea. Un número se declara con `CampoNumero` y su `tipo` (importe, cantidad, entero,
 * porcentaje), que ya trae el teclado decimal, la lectura de «1.234,56» y la validación bloqueante. Cuenta, por archivo, los `<input>` y `<Campo>` con `inputMode` numérico escritos FUERA de `src/ui/` (en `src/` y en la
 * consola, `plataforma/src/`); `CampoNumero` mismo (`src/components/campo-numero.tsx`) es el único que lo pone por derecho. Mira el AST: un comentario o un string no cuentan.
 * Meta: 0. Los códigos de dígitos (el PIN de una invitación, el CUIT, el código de ingreso) NO son un número: piden un tipo propio de código (pendiente), y hasta entonces son deuda declarada, con su motivo por archivo.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const ELEMENTOS = new Set(["input", "Campo"]);
const TECLADOS_NUMERICOS = new Set(["numeric", "decimal"]);

function tieneTecladoNumerico(atributos: ts.JsxAttributes): boolean {
  return atributos.properties.some((a) => {
    if (!ts.isJsxAttribute(a) || a.name.getText() !== "inputMode" || !a.initializer) return false;
    const valor = ts.isStringLiteral(a.initializer) ? a.initializer : ts.isJsxExpression(a.initializer) && a.initializer.expression && ts.isStringLiteral(a.initializer.expression) ? a.initializer.expression : null;
    return valor !== null && TECLADOS_NUMERICOS.has(valor.text);
  });
}

function contarTecladosNumericos(fuente: string, ruta: string): Record<string, number> {
  const cuenta: Record<string, number> = { "inputmode-numerico": 0 };
  const visitar = (nodo: ts.Node): void => {
    if ((ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) && ts.isIdentifier(nodo.tagName) && ELEMENTOS.has(nodo.tagName.text) && tieneTecladoNumerico(nodo.attributes)) cuenta["inputmode-numerico"]++;
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbolDe(fuente, ruta));
  return cuenta;
}

const NUMERO = (donde: string, tipo: string) => `${donde}: un número con \`inputMode\` numérico a mano; pasa a \`CampoNumero tipo="${tipo}"\`.`;
const CODIGO = (donde: string) => `${donde}: un código de dígitos (no un número que se opere); pasa a un tipo de código declarado cuando exista (hoy solo tiene el teclado numérico).`;

const CERCO_INPUTMODE_NUMERICO: Cerco = {
  regla: "inputmode-numerico-a-mano",
  meta: "0 (lote 6.33: un número es un CampoNumero con su tipo; un código de dígitos, un tipo de código declarado)",
  medir: medirPorArchivo({
    raices: ["src", "plataforma/src"],
    extensiones: [".tsx", ".jsx"],
    incluir: (ruta) => !ruta.startsWith("src/ui/") && ruta !== "src/components/campo-numero.tsx",
    contar: contarTecladosNumericos,
  }),
  motivos: {
    "plataforma/src/app/instalaciones/[instalacion]/empresas/[id]/botones.tsx": CODIGO("El CUIT de la consola (confirmar y corregir)"),
    "plataforma/src/app/login/formulario.tsx": CODIGO("El código de ingreso de la consola"),
    "src/app/(app)/carta/mantenimiento-de-carta.tsx": NUMERO("El valor de la hoja de precios de la carta (prototipo aprobado, decisión de producto)", "importe"),
    "src/app/(app)/catalogo/margen-objetivo/page.tsx": NUMERO("El margen objetivo de la empresa y de las categorías", "porcentaje"),
    "src/app/(app)/catalogo/opciones/[grupoId]/page.tsx": NUMERO("Mínimo y máximo a elegir de un grupo de opciones", "entero"),
    "src/app/(app)/catalogo/opciones/alta-de-grupo.tsx": NUMERO("Mínimo y máximo a elegir del alta de un grupo de opciones", "entero"),
    "src/app/(app)/catalogo/productos/[id]/opciones/admision-de-grupo.tsx": NUMERO("Orden, mínimo, máximo y tope por opción de un grupo en el producto", "entero"),
    "src/app/(pos)/mesas/[mesaId]/abrir-cuenta.tsx": NUMERO("Los comensales al abrir una cuenta (POS)", "entero"),
    "src/app/(pos)/mesas/[mesaId]/agregar-items.tsx": NUMERO("La cantidad y el precio de un ítem del POS", "cantidad"),
    "src/app/(pos)/mesas/[mesaId]/comensales-cuenta.tsx": NUMERO("Los comensales de una cuenta (POS)", "entero"),
    "src/app/(pos)/mesas/limite-mesas.tsx": NUMERO("El límite de mesas (POS)", "entero"),
    "src/app/invitacion/formulario-de-aceptacion.tsx": CODIGO("El código de una invitación"),
  },
};

describe("cerco «teclado numérico a mano»: el detector", () => {
  it("cuenta <input> y <Campo> con inputMode numeric o decimal (literal o entre llaves)", () => {
    const fuente = [
      "export const F = () => (",
      "  <form>",
      '    <input inputMode="numeric" name="a" />',
      '    <Campo etiqueta="x" inputMode={"decimal"} />',
      '    <Campo etiqueta="y" inputMode="numeric"></Campo>',
      "  </form>",
      ");",
    ].join("\n");
    expect(contarTecladosNumericos(fuente, "x.tsx")).toEqual({ "inputmode-numerico": 3 });
  });

  it("no cuenta otros teclados, otros componentes, un comentario ni un string", () => {
    const fuente = 'export const F = () => <><input inputMode="url" /><Campo inputMode="email" /><Otro inputMode="numeric" />{/* <input inputMode="numeric" /> */}<p>{\'inputMode="numeric"\'}</p></>;';
    expect(contarTecladosNumericos(fuente, "x.tsx")).toEqual({ "inputmode-numerico": 0 });
  });
});

probarCerco(CERCO_INPUTMODE_NUMERICO);
