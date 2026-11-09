import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { leerCantidadTecleada } from "../../src/core/catalogo/public";
import { LecturaDeCantidad } from "../../src/components/receta/lectura-de-cantidad";

/**
 * La frase llana debajo del campo de cantidad (docs/diseno-guardia-de-unidad-receta-2026-11-09.md, nivel 9). El aviso de la guardia y el botón «Sí, es esa cantidad: guardar» (cliente: estado y eventos) los cubre
 * el e2e `test/e2e/receta-guardia-de-unidad.spec.ts`; el rechazo del servidor, `guardia-de-unidad-servidor.test.ts`.
 */
const KG = { nombre: "kg", menor: { nombre: "g", factor: 1000 } };
const DESCRIPCION = { insumo: "Bife de nalga", producto: "Milanesa con papas fritas" };

describe("la lectura en vivo suma una frase en lenguaje llano", () => {
  it("«0,22» en kg: «Lleva 0,22 kg de Bife de nalga por cada unidad vendida de Milanesa con papas fritas.» (en la unidad de stock, sin convertir)", () => {
    const l = leerCantidadTecleada("0,22", KG, DESCRIPCION);
    expect(l).toMatchObject({ tipo: "valor", valor: 0.22, lectura: "= 220 g", frase: "Lleva 0,22 kg de Bife de nalga por cada unidad vendida de Milanesa con papas fritas." });
  });

  it("sin descripción o sin unidad no hay frase (la lectura de siempre queda igual)", () => {
    expect(leerCantidadTecleada("0,22", KG)).toMatchObject({ lectura: "= 220 g", frase: null });
    expect(leerCantidadTecleada("0,22", null, DESCRIPCION)).toMatchObject({ frase: null });
  });

  it("vacío o ambiguo: nada que decir", () => {
    expect(leerCantidadTecleada("", KG, DESCRIPCION)).toEqual({ tipo: "vacio" });
    expect(leerCantidadTecleada("1.205", KG, DESCRIPCION).tipo).toBe("invalido");
  });

  it("el componente la dibuja debajo del campo con lo guardado, y no si no recibe la descripción", () => {
    const con = renderToStaticMarkup(
      <LecturaDeCantidad campoId="c1" valorInicial="0.22" unidad={KG} descripcion={DESCRIPCION}>
        <input id="c1" />
      </LecturaDeCantidad>
    );
    expect(con).toContain("data-frase-de-cantidad");
    expect(con).toContain("Lleva 0,22 kg de Bife de nalga por cada unidad vendida de Milanesa con papas fritas.");
    expect(con).toContain("= 220 g");
    const sin = renderToStaticMarkup(
      <LecturaDeCantidad campoId="c1" valorInicial="0.22" unidad={KG}>
        <input id="c1" />
      </LecturaDeCantidad>
    );
    expect(sin).not.toContain("data-frase-de-cantidad");
  });
});
