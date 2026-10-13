import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatearMonto } from "../../../src/core/pos/formato";
import { porcentajeDeImporte } from "../../../src/core/moneda";
import {
  ayudaDelTipoDeGrupo,
  espejoDeDiferencia,
  esGrupoObligatorio,
  nombreDelTipoDeGrupo,
  resumenDeConsumos,
  textoDeDiferencia,
  textoDeLimites,
  textoDePorcentaje,
} from "../../../src/core/opciones/presentacion";
import { TIPOS_DE_GRUPO_DE_OPCIONES } from "../../../src/core/opciones/tipos";

/**
 * GO-2d: los textos puros de las pantallas de opciones de venta. Lo que se fija acá es lo que lee una persona: sin «MEDIDA», sin «versión», con coma decimal y con el espejo
 * de un porcentaje calculado con la MISMA cuenta exacta que la venta.
 */

describe("nombre y ayuda de cada tipo de grupo", () => {
  it("cada tipo tiene su nombre en palabras, distinto de los demás y sin el nombre interno", () => {
    expect(TIPOS_DE_GRUPO_DE_OPCIONES.map(nombreDelTipoDeGrupo)).toEqual(["Tamaño", "Variante", "Incluida sin costo", "Adicional con recargo"]);
    for (const tipo of TIPOS_DE_GRUPO_DE_OPCIONES) expect(nombreDelTipoDeGrupo(tipo)).not.toMatch(/MEDIDA|VARIANTE|INCLUIDA|ADICIONAL/);
  });

  it("cada tipo tiene una ayuda de una línea, distinta de las otras y sin jerga", () => {
    const ayudas = TIPOS_DE_GRUPO_DE_OPCIONES.map(ayudaDelTipoDeGrupo);
    expect(new Set(ayudas).size).toBe(4);
    for (const a of ayudas) {
      expect(a.length).toBeGreaterThan(20);
      expect(a).not.toMatch(/versi[oó]n|MEDIDA|VARIANTE|INCLUIDA|ADICIONAL|\n/);
    }
    expect(ayudaDelTipoDeGrupo("ADICIONAL")).toContain("se cobra aparte");
    expect(ayudaDelTipoDeGrupo("INCLUIDA")).toContain("sin costo");
  });
});

describe("textoDeLimites", () => {
  it("obligatorio de uno, opcional con tope y rango", () => {
    expect(textoDeLimites(1, 1)).toBe("Elegí 1");
    expect(textoDeLimites(2, 2)).toBe("Elegí 2");
    expect(textoDeLimites(0, 2)).toBe("Opcional · hasta 2");
    expect(textoDeLimites(0, 1)).toBe("Opcional · hasta 1");
    expect(textoDeLimites(1, 3)).toBe("Elegí de 1 a 3");
  });

  it("esGrupoObligatorio: solo con mínimo 1 o más", () => {
    expect(esGrupoObligatorio(0)).toBe(false);
    expect(esGrupoObligatorio(1)).toBe(true);
    expect(esGrupoObligatorio(3)).toBe(true);
  });
});

describe("textoDeDiferencia", () => {
  it("montos con signo y el formato de quien muestra", () => {
    expect(textoDeDiferencia({ tipo: "MONTO", monto: 400 }, formatearMonto)).toBe(`+ ${formatearMonto(400)}`);
    expect(textoDeDiferencia({ tipo: "MONTO", monto: -200.5 }, formatearMonto)).toBe(`− ${formatearMonto(200.5)}`);
    expect(textoDeDiferencia({ tipo: "MONTO", monto: 0 }, formatearMonto)).toBe("sin recargo");
    expect(textoDeDiferencia(null, formatearMonto)).toBe("sin recargo");
  });

  it("porcentajes con coma decimal y sin ceros de más", () => {
    expect(textoDeDiferencia({ tipo: "PORCENTAJE", porcentaje: 16 }, formatearMonto)).toBe("+ 16 %");
    expect(textoDeDiferencia({ tipo: "PORCENTAJE", porcentaje: -12.5 }, formatearMonto)).toBe("− 12,5 %");
    expect(textoDeDiferencia({ tipo: "PORCENTAJE", porcentaje: 0 }, formatearMonto)).toBe("sin recargo");
    expect(textoDePorcentaje(7.125)).toBe("7,125");
    expect(textoDePorcentaje(1234.5)).toBe("1234,5");
  });
});

describe("espejoDeDiferencia (referencia, no precio cobrado)", () => {
  it("un monto se lee como porcentaje del precio de referencia, con un decimal", () => {
    expect(espejoDeDiferencia({ tipo: "MONTO", monto: 400 }, 2500)).toEqual({ tipo: "PORCENTAJE", porcentaje: 16 });
    expect(espejoDeDiferencia({ tipo: "MONTO", monto: 100 }, 3000)).toEqual({ tipo: "PORCENTAJE", porcentaje: 3.3 });
    expect(espejoDeDiferencia({ tipo: "MONTO", monto: -250 }, 1000)).toEqual({ tipo: "PORCENTAJE", porcentaje: -25 });
  });

  it("un porcentaje se lee como el monto que da, con la cuenta exacta de la venta", () => {
    expect(espejoDeDiferencia({ tipo: "PORCENTAJE", porcentaje: 16 }, 2500)).toEqual({ tipo: "MONTO", monto: 400 });
    // Empate de medio centavo: la venta redondea mitad hacia arriba una sola vez; el espejo da lo mismo.
    expect(espejoDeDiferencia({ tipo: "PORCENTAJE", porcentaje: 7.1 }, 0.5)).toEqual({ tipo: "MONTO", monto: porcentajeDeImporte(0.5, 7.1) });
  });

  it("sin precio de referencia no hay espejo", () => {
    expect(espejoDeDiferencia({ tipo: "MONTO", monto: 400 }, 0)).toBeNull();
    expect(espejoDeDiferencia({ tipo: "PORCENTAJE", porcentaje: 10 }, -5)).toBeNull();
    expect(espejoDeDiferencia({ tipo: "PORCENTAJE", porcentaje: 10 }, Number.NaN)).toBeNull();
  });

  it("propiedad: el espejo de un porcentaje es SIEMPRE el importe exacto de la venta", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000 }), fc.integer({ min: -9999, max: 99999 }), (centavos, p10000) => {
        const precio = centavos / 100;
        const porcentaje = p10000 / 100;
        expect(espejoDeDiferencia({ tipo: "PORCENTAJE", porcentaje }, precio)).toEqual({ tipo: "MONTO", monto: porcentajeDeImporte(precio, porcentaje) });
      })
    );
  });
});

describe("resumenDeConsumos", () => {
  const formatear = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 4 });
  it("suma y reemplaza, con merma y escala, en una frase por línea", () => {
    expect(
      resumenDeConsumos(
        [
          { efecto: "SUMA", insumoNombre: "Leche", reemplazaNombre: null, cantidad: 0.2, unidadNombre: "l", mermaPorcentaje: 0, escalaConLaMedida: false },
          { efecto: "REEMPLAZA", insumoNombre: "Bebida de almendras", reemplazaNombre: "Leche", cantidad: 0.25, unidadNombre: "l", mermaPorcentaje: 2.5, escalaConLaMedida: true },
        ],
        formatear
      )
    ).toBe("suma 0,2 l de Leche; reemplaza Leche por 0,25 l de Bebida de almendras · merma 2,5 % · escala con el tamaño");
  });
  it("sin líneas, y sin unidad", () => {
    expect(resumenDeConsumos([], formatear)).toBe("sin consumo propio");
    expect(resumenDeConsumos([{ efecto: "SUMA", insumoNombre: "Huevo", reemplazaNombre: null, cantidad: 1, unidadNombre: "", mermaPorcentaje: 0, escalaConLaMedida: false }], formatear)).toBe("suma 1 de Huevo");
  });
});
