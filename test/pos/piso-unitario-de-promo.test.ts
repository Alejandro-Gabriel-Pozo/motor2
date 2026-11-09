import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMPORTE_MINIMO } from "../../src/core/moneda";
import { IMPORTE_MINIMO as DESDE_OPCIONES } from "../../src/core/opciones/tipos";
import { precioConDescuento } from "../../src/core/moneda";
import { precioMinimoPromo, prorratearPrecioPromo } from "../../src/core/pos/promo-combo";
import { rechazoDeComponenteDeCombo } from "../../src/core/pos/componente-de-combo";
import { pisoDePrecioDePromo, mensajePisoDePromo } from "../../src/core/carta/piso-de-promo";

/** El piso de $0,01 por unidad es UNA constante (`IMPORTE_MINIMO`, core/moneda.ts): todos los usos la leen. */
describe("piso unitario: una sola constante", () => {
  it("vale 0,01 y las dos rutas de importación son la misma", () => {
    expect(IMPORTE_MINIMO).toBe(0.01);
    expect(DESDE_OPCIONES).toBe(IMPORTE_MINIMO);
  });
  it("precioConDescuento con 99,99 % de un precio chico cae exactamente en el piso", () => {
    expect(precioConDescuento(0.01, 99.99)).toBe(IMPORTE_MINIMO);
  });
  it("precioMinimoPromo = piso × unidades", () => {
    expect(precioMinimoPromo([{ cantidad: 3 }, { cantidad: 2 }])).toBe(0.05);
    expect(pisoDePrecioDePromo([{ cantidadMaxima: 4 }])?.minimo).toBe(0.04);
  });
  it("prorratear: un precio justo en el piso deja cada unidad en el piso; uno por debajo se rechaza", () => {
    const comp = [{ productoId: "a", cantidad: 2, precioCarta: 100000 }, { productoId: "b", cantidad: 1, precioCarta: 1 }];
    const ok = prorratearPrecioPromo(0.03, comp);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.filas.every((f) => f.precioUnitario >= IMPORTE_MINIMO)).toBe(true);
    expect(prorratearPrecioPromo(0.02, comp).ok).toBe(false);
  });
  it("componente de combo: el precio de referencia debajo del piso se rechaza, en el piso se acepta", () => {
    const base = { id: "p", nombre: "P", tipo: "PV", esAnclaDeAdicional: false, seProduce: true, ingredientesDeLaRecetaVigente: 1, precioDeReferencia: 0 };
    // Solo interesa el chequeo de precio: se compara el resultado con el de justo el piso.
    const bajo = rechazoDeComponenteDeCombo({ ...base, precioDeReferencia: IMPORTE_MINIMO - 0.001 });
    const justo = rechazoDeComponenteDeCombo({ ...base, precioDeReferencia: IMPORTE_MINIMO });
    expect(bajo?.codigo).toBe("COMPONENTE_SIN_PRECIO_DE_REFERENCIA");
    expect(justo?.codigo).not.toBe("COMPONENTE_SIN_PRECIO_DE_REFERENCIA");
  });
  it("el mensaje al usuario nombra el piso", () => {
    expect(mensajePisoDePromo("Combo", 0.01, { minimo: 0.05, unidades: 5 })).toContain("$0,01");
  });
});

describe("guardián: nadie escribe el piso a mano", () => {
  const RAIZ = join(__dirname, "../..");
  const ARCHIVOS = ["src/core/pos/promo-combo.ts", "src/core/pos/componente-de-combo.ts", "src/core/carta/piso-de-promo.ts"];
  it.each(ARCHIVOS)("%s no tiene el literal 0.01 en el código", (ruta) => {
    const codigo = readFileSync(join(RAIZ, ruta), "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(codigo).not.toMatch(/\b0\.01\b/);
  });
  it("moneda.ts define la constante y precioConDescuento la usa", () => {
    const m = readFileSync(join(RAIZ, "src/core/moneda.ts"), "utf8");
    expect(m).toMatch(/export const IMPORTE_MINIMO = 0\.01/);
    expect(m.match(/\b0\.01\b/g)?.length).toBe(1);
  });
});
