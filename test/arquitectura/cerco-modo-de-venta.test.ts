import ts from "typescript";
import { describe, expect, it } from "vitest";
import { arbolDe, medirPorArchivo, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «modo de venta y tipo de producto con su nombre» (lote 3a de «bajar la deuda»; hallazgo de la auditoría del catálogo común, 2026-11-06): el modo de venta de un producto (`DIRECTO` /
 * `BASE_CONFIGURABLE`) se compara con `esBaseConfigurable` (o se normaliza con `modoDeVentaDe`), se escribe con `MODO_DE_VENTA` y se tipa con `ModoDeVenta`; el tipo de producto se tipa con
 * `TipoProducto`. Antes cada sitio lo escribía a mano (`=== "BASE_CONFIGURABLE"`, `"MP" | "PV"`): si el día de mañana aparece un tercer modo, un sitio olvidado decidiría mal el precio.
 *
 * Cuenta, en `src/` y en `plataforma/src/`, mirando el AST (un comentario o un nombre de código como `ES_BASE_CONFIGURABLE` no cuentan):
 *  - `modo-de-venta-literal`: cada texto exacto `"DIRECTO"` o `"BASE_CONFIGURABLE"` (como valor o como tipo literal);
 *  - `tipo-de-producto-literal`: cada unión de tipos que lista a la vez `"MP"` y `"PV"` (es `TipoProducto`).
 * Los únicos lugares donde se definen están exceptuados con su motivo. Meta: 0 (ya está en 0: una aparición nueva rompe el gate).
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const MODOS = new Set(["DIRECTO", "BASE_CONFIGURABLE"]);

function contarLiteralesDeModoYTipo(fuente: string, ruta: string): Record<string, number> {
  const cuenta: Record<string, number> = { "modo-de-venta-literal": 0, "tipo-de-producto-literal": 0 };
  const visitar = (nodo: ts.Node): void => {
    if ((ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) && MODOS.has(nodo.text)) cuenta["modo-de-venta-literal"]++;
    if (ts.isUnionTypeNode(nodo)) {
      const textos = new Set(nodo.types.flatMap((t) => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? [t.literal.text] : [])));
      if (textos.has("MP") && textos.has("PV")) cuenta["tipo-de-producto-literal"]++;
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(arbolDe(fuente, ruta));
  return cuenta;
}

const CERCO_MODO_DE_VENTA: Cerco = {
  regla: "modo-de-venta-literal",
  meta: "0 (lote 3a: el modo de venta se compara con esBaseConfigurable y se tipa con ModoDeVenta; el tipo de producto con TipoProducto)",
  medir: medirPorArchivo({ raices: ["src", "plataforma/src"], extensiones: [".ts", ".tsx"], contar: contarLiteralesDeModoYTipo }),
  excepciones: [
    { ruta: "src/core/opciones/tipos.ts", motivo: "Define `MODOS_DE_VENTA`, `ModoDeVenta` y `MODO_DE_VENTA`: es el único lugar donde se escriben los textos del modo de venta." },
    { ruta: "src/core/datos/enumerados-del-esquema.ts", motivo: "Define `TipoProducto` (espejo del `enum TipoProducto` del esquema): es el único lugar donde se escribe la unión." },
  ],
};

describe("cerco «modo de venta»: el detector", () => {
  it("cuenta el texto exacto de un modo, como valor, en una comparación, en un where o como tipo", () => {
    const fuente = [
      'const a = p.modoDeVenta === "BASE_CONFIGURABLE";',
      'const b = { modoDeVenta: { not: "BASE_CONFIGURABLE" } };',
      'type M = "DIRECTO" | "BASE_CONFIGURABLE";',
      "const c = `DIRECTO`;",
    ].join("\n");
    expect(contarLiteralesDeModoYTipo(fuente, "x.ts")["modo-de-venta-literal"]).toBe(5);
  });

  it("no cuenta códigos de error parecidos, filtros de pantalla ni un comentario", () => {
    const fuente = [
      '// antes: "BASE_CONFIGURABLE"',
      'const a = fracaso("ES_BASE_CONFIGURABLE", "x");',
      'const b = f.modo === "directo";',
      "const c = MODO_DE_VENTA.BASE_CONFIGURABLE;",
    ].join("\n");
    expect(contarLiteralesDeModoYTipo(fuente, "x.ts")["modo-de-venta-literal"]).toBe(0);
  });

  it("cuenta la unión MP/PV en cualquier orden y no un solo valor ni otra unión", () => {
    expect(contarLiteralesDeModoYTipo('type A = "MP" | "PV"; type B = "PV" | "MP"; type C = "MP" | "PV" | null;', "x.ts")["tipo-de-producto-literal"]).toBe(3);
    expect(contarLiteralesDeModoYTipo('const t = p.tipo === "PV"; type D = "MP" | "OTRO";', "x.ts")["tipo-de-producto-literal"]).toBe(0);
  });
});

probarCerco(CERCO_MODO_DE_VENTA);
