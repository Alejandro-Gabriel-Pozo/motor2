import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { contextoDelCampo, errorDelCampo, textoParaEditar, textoParaVer, valorAEmitir } from "@/core/datos/campo-numero-logica";
import { CONTEXTO_CANTIDAD_SIN_UNIDAD, CONTEXTO_IMPORTE, MARCA_DE_NO_CANONICO, contextoDeCantidad, interpretarNumeroTecleado, leerNumeroCanonico } from "@/core/datos/numero-tecleado";

/**
 * Micro-paso 2c: la lógica pura de `CampoNumero` — qué contexto tiene el campo, qué EMITE cuando la persona teclea, cómo se ve y qué error dice. Sin DOM: el componente solo la conecta.
 */
const KG = contextoDeCantidad(3);
const ENTERA = contextoDeCantidad(0);

describe("contextoDelCampo", () => {
  it("un importe admite 2 decimales; una cantidad, los de su unidad; sin tipo o sin decimales, los 4 de las columnas (nunca se adivina «1.205»)", () => {
    expect(contextoDelCampo("importe", undefined)).toEqual(CONTEXTO_IMPORTE);
    expect(contextoDelCampo("importe", 5)).toEqual(CONTEXTO_IMPORTE); // `decimales` es de las cantidades
    expect(contextoDelCampo("cantidad", 3)).toEqual({ decimales: 3 });
    expect(contextoDelCampo("cantidad", 0)).toEqual({ decimales: 0 });
    expect(contextoDelCampo("cantidad", undefined)).toEqual(CONTEXTO_CANTIDAD_SIN_UNIDAD);
    expect(contextoDelCampo(undefined, undefined)).toEqual(CONTEXTO_CANTIDAD_SIN_UNIDAD);
  });
});

describe("valorAEmitir — lo que sale del campo al tipear", () => {
  it.each([
    ["21.000", CONTEXTO_IMPORTE, "21000"], // veintiún mil: en un importe el punto con tres cifras es de miles
    ["21,5", CONTEXTO_IMPORTE, "21.5"],
    ["1.234,56", CONTEXTO_IMPORTE, "1234.56"],
    ["0,5", KG, "0.5"],
    ["1,205", KG, "1.205"], // canónico: el punto es el decimal
    ["1.205", ENTERA, "1205"],
    [" 5 ", KG, "5"],
    ["5,", KG, "5"],
    ["", KG, ""],
    ["   ", KG, ""],
  ])("%j en %j → %j", (texto, contexto, esperado) => {
    expect(valorAEmitir(texto, contexto)).toBe(esperado);
  });

  it("lo que no es un número sale TAL CUAL (nunca vacío ni 0), así un required lo cuenta como cargado y el servidor lo rechaza", () => {
    for (const t of ["abc", "21,000", "1e3", "1,234.56", "5-3"]) expect(valorAEmitir(t, CONTEXTO_IMPORTE), t).toBe(t);
  });

  it("«1.205» en kilos es ambiguo y PARECE canónico (1,205): sale marcado, y ni el lector canónico ni Number() lo leen", () => {
    const emitido = valorAEmitir("1.205", KG);
    expect(emitido).toBe(`1.205${MARCA_DE_NO_CANONICO}`);
    expect(leerNumeroCanonico(emitido).ok).toBe(false);
    expect(Number(emitido)).toBeNaN();
  });

  it("«1.5» en una unidad entera (error de decimales) también parece canónico: sale marcado", () => {
    expect(valorAEmitir("1.5", ENTERA)).toBe(`1.5${MARCA_DE_NO_CANONICO}`);
  });
});

describe("textoParaVer y textoParaEditar", () => {
  it("al salir del campo se ve el número en es-AR; al entrar, con coma y sin miles", () => {
    // El agrupado de miles de los números de 4 cifras depende del ICU del entorno: se acepta con o sin separador.
    expect(textoParaVer("1234.5")).toMatch(/^1\.?234,5$/);
    expect(textoParaVer("21000")).toBe("21.000");
    expect(textoParaVer("0.5")).toBe("0,5");
    expect(textoParaVer("")).toBe("");
    expect(textoParaEditar("1.205")).toBe("1,205");
    expect(textoParaEditar("21000")).toBe("21000");
    expect(textoParaEditar("-0.5")).toBe("-0,5");
    expect(textoParaEditar("")).toBe("");
  });

  it("un texto que no era un número se muestra como se escribió, sin la marca", () => {
    for (const f of [textoParaVer, textoParaEditar]) {
      expect(f(`1.205${MARCA_DE_NO_CANONICO}`)).toBe("1.205");
      expect(f("abc")).toBe("abc");
      expect(f("21,000")).toBe("21,000");
    }
  });

  it("lo que se edita al entrar se lee igual al salir sin tocar nada (la edición no cambia el valor)", () => {
    fc.assert(
      fc.property(fc.integer({ min: -9_999_999, max: 9_999_999 }), fc.integer({ min: 0, max: 999 }), (entero, milesimos) => {
        const canonico = `${entero}.${String(milesimos).padStart(3, "0")}`.replace(/\.?0+$/, "") || "0";
        const editado = textoParaEditar(canonico);
        expect(valorAEmitir(editado, KG), `${canonico} → ${editado}`).toBe(valorAEmitir(canonico.replace(".", ","), KG));
        const original = leerNumeroCanonico(canonico);
        const releido = leerNumeroCanonico(valorAEmitir(editado, KG));
        expect(releido).toEqual(original);
      })
    );
  });
});

describe("errorDelCampo — por qué el valor no sirve", () => {
  it("lo que se tecleó y no se entiende dice cómo escribirlo, y es del origen «tecleado» (se muestra junto al campo)", () => {
    expect(errorDelCampo(`1.205${MARCA_DE_NO_CANONICO}`, KG, {})).toEqual({ origen: "tecleado", mensaje: "¿1,205 o 1205? Escribí 1205 o 1,205." });
    expect(errorDelCampo("abc", CONTEXTO_IMPORTE, {})).toEqual({ origen: "tecleado", mensaje: "No es un número válido." });
    expect(errorDelCampo("1,5", ENTERA, {})).toEqual({ origen: "tecleado", mensaje: "Tiene que ser un número entero." });
  });

  it("con tipo (o etiqueta), el mensaje lleva el sujeto del campo, como el de la Server Action", () => {
    expect(errorDelCampo(`1.205${MARCA_DE_NO_CANONICO}`, KG, { tipo: "cantidad", etiqueta: "El factor" })).toEqual({ origen: "tecleado", mensaje: "El factor: ¿1,205 o 1205? Escribí 1205 o 1,205." });
    expect(errorDelCampo("21,000", CONTEXTO_IMPORTE, { tipo: "importe", etiqueta: "El precio de venta" })).toEqual({
      origen: "tecleado",
      mensaje: "El precio de venta admite como máximo 2 decimales. Para 21000 escribí 21000 o 21.000,00.",
    });
    expect(errorDelCampo("abc", CONTEXTO_IMPORTE, { tipo: "importe" })).toEqual({ origen: "tecleado", mensaje: "El importe no es un número válido." });
    expect(errorDelCampo("1,5", ENTERA, { tipo: "cantidad" })).toEqual({ origen: "tecleado", mensaje: "La cantidad tiene que ser un número entero." });
  });

  it("un número leído que no cumple la regla (signo, tope, decimales de la unidad) dice lo mismo que la Server Action, y es del origen «regla»", () => {
    expect(errorDelCampo("-5", CONTEXTO_IMPORTE, { tipo: "importe", etiqueta: "El precio" })).toEqual({ origen: "regla", mensaje: "El precio no puede ser negativo." });
    expect(errorDelCampo("1.5", ENTERA, { tipo: "cantidad", etiqueta: "La cantidad" })?.origen).toBe("regla");
  });

  it("válido, vacío o sin tipo (solo formato): sin error", () => {
    expect(errorDelCampo("1234.5", CONTEXTO_IMPORTE, { tipo: "importe" })).toBeNull();
    expect(errorDelCampo("", CONTEXTO_IMPORTE, { tipo: "importe" })).toBeNull();
    expect(errorDelCampo("-3", KG, {})).toBeNull();
    expect(errorDelCampo("3", KG, { tipo: "cantidad" })).toBeNull();
  });

  it("propiedad: lo que emite el campo da error SI Y SOLO SI el parser no lo entiende; y lo que sí entiende, se lee como el mismo número", () => {
    const contextos = fc.integer({ min: 0, max: 6 }).map(contextoDeCantidad);
    fc.assert(
      fc.property(fc.oneof(fc.string({ maxLength: 15 }), fc.stringMatching(/^-?\d{1,4}([.,]\d{1,5})?$/), fc.stringMatching(/^\d{1,3}(\.\d{3}){1,2}(,\d{1,3})?$/)), contextos, (texto, contexto) => {
        const parseado = interpretarNumeroTecleado(texto, contexto);
        const emitido = valorAEmitir(texto, contexto);
        const error = errorDelCampo(emitido, contexto, {});
        if (parseado.ok) {
          expect(error, JSON.stringify(texto)).toBeNull();
          expect(leerNumeroCanonico(emitido)).toEqual({ ok: true, valor: parseado.valor });
        } else {
          expect(error?.origen, JSON.stringify(texto)).toBe("tecleado");
          expect(leerNumeroCanonico(emitido).ok || emitido === "", JSON.stringify(texto)).toBe(false);
        }
      }),
      { numRuns: 1000 }
    );
  });
});
