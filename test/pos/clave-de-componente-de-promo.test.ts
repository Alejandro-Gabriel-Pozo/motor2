import fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claveDeComponente, claveDeComponenteConfigurado } from "../../src/core/pos/promo-combo";

/**
 * La clave que identifica a cada plato dentro de una promo se construye en UN solo lugar (`claveDeComponente`). Si una copia a mano divergiera, el precio de lista no se
 * encontraría y el plato pesaría $0 en el reparto del precio de la promo. Estos tests fijan los 3 formatos (oráculo escrito aparte del código) y vigilan que nadie vuelva a armarla a mano.
 */
describe("claveDeComponente: los formatos", () => {
  it("producto pelado (componente de sección o entrada fija sin configuración)", () => {
    expect(claveDeComponente("p1", { forma: "producto" })).toBe("p1");
  });
  it("configurada: id#canónico; con canónico vacío, el id con marca «#»", () => {
    expect(claveDeComponente("p1", { forma: "configurada", claveConfiguracion: "op-a=1;op-b=2" })).toBe("p1#op-a=1;op-b=2");
    expect(claveDeComponente("p1", { forma: "configurada", claveConfiguracion: "" })).toBe("p1#");
  });
  it("marcador de entrada «a elegir»: id#@entradaId", () => {
    expect(claveDeComponente("p1", { forma: "a-elegir", entradaId: "e9" })).toBe("p1#@e9");
  });
  it("claveDeComponenteConfigurado sigue igual: canónico vacío es el producto pelado", () => {
    expect(claveDeComponenteConfigurado("p1", "")).toBe("p1");
    expect(claveDeComponenteConfigurado("p1", "op=1")).toBe("p1#op=1");
  });
});

describe("claveDeComponente: propiedades", () => {
  const id = fc.stringMatching(/^[a-z0-9-]{1,12}$/);
  const canonico = fc.stringMatching(/^[a-z0-9=;-]{1,20}$/);
  it("las tres formas nunca colisionan para el mismo producto", () => {
    fc.assert(
      fc.property(id, canonico, id, (p, c, e) => {
        const claves = [
          claveDeComponente(p, { forma: "producto" }),
          claveDeComponente(p, { forma: "configurada", claveConfiguracion: "" }),
          claveDeComponente(p, { forma: "configurada", claveConfiguracion: c }),
          claveDeComponente(p, { forma: "a-elegir", entradaId: e }),
        ];
        // «configurada» con canónico que empieza con «@» podría parecerse al marcador: el canónico real nunca lo hace (empieza con un opcionId, sin «@»).
        return new Set(claves).size === claves.length;
      }),
    );
  });
  it("es determinística y empieza siempre por el id del producto", () => {
    fc.assert(
      fc.property(id, canonico, (p, c) => claveDeComponente(p, { forma: "configurada", claveConfiguracion: c }) === `${p}#${c}` && claveDeComponente(p, { forma: "producto" }).startsWith(p)),
    );
  });
});

describe("guardián: nadie arma la clave a mano", () => {
  const RAIZ = join(__dirname, "../..");
  const ARCHIVOS = ["src/core/pos/promo-combo.ts", "src/server/lecturas/pos/entradas-de-promo-para-vender.ts"];
  it.each(ARCHIVOS)("%s no concatena «#» a mano", (ruta) => {
    const sinComentarios = readFileSync(join(RAIZ, ruta), "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    // El único lugar autorizado es el cuerpo de `claveDeComponente` (promo-combo.ts), marcado con CLAVE-UNICA.
    const fuera = sinComentarios.split("\n").filter((l) => /\}#|#\$\{|[`"']#/.test(l) && !l.includes("CLAVE-UNICA"));
    expect(fuera).toEqual([]);
  });
});
