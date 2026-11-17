import { describe, expect, it } from "vitest";
import { importeDeLinea } from "../../src/core/moneda";
import { repartoDelPrecioDeLaPromo, textoDeLaFilaDelReparto, type ParteParaRepartir } from "../../src/core/carta/reparto-del-precio-de-la-promo";

/**
 * «Reparto del precio» de una promo (solo lectura, detrás de `ARMADO_DE_PROMO_COMO_PEDERNAL`). La función es PURA y reparte con `prorratearPrecioPromo` (el mismo que congela el precio al vender): acá se fija el
 * oráculo escrito aparte del código (los importes, al centavo, que da la proporción al precio de lista) y los bordes: cantidad N > 1, rango (se usa el máximo), sin producto, error de piso.
 */
const parte = (nombre: string, min: number, max: number, ejemplo: { nombre: string; precioLista: number } | null): ParteParaRepartir => ({ nombre, cantidadMinima: min, cantidadMaxima: max, ejemplo });
const BARBACOA = parte("Platos", 1, 1, { nombre: "Barbacoa", precioLista: 12000 });
const GASEOSA = parte("Bebidas", 1, 1, { nombre: "Gaseosa", precioLista: 2200 });

describe("repartoDelPrecioDeLaPromo", () => {
  it("el ejemplo de la maqueta de Pedernal: $ 13.500,00 entre Barbacoa (lista 12.000) y Gaseosa (lista 2.200) suma EXACTO $ 13.500,00", () => {
    const r = repartoDelPrecioDeLaPromo(13500, [BARBACOA, GASEOSA]);
    expect(r.tipo).toBe("ok");
    if (r.tipo !== "ok") return;
    // 13500 × 12000 / 14200 = 11408,45 (redondeo al centavo); el resto, 2091,55.
    expect(r.filas.map((f) => [f.producto, f.reparto, f.lista])).toEqual([["Barbacoa", 11408.45, 12000], ["Gaseosa", 2091.55, 2200]]);
    expect(r.filas.reduce((s, f) => s + f.reparto, 0).toFixed(2)).toBe("13500.00");
    expect(r.usaMaximo).toBe(false);
    expect(textoDeLaFilaDelReparto(r.filas[0]!)).toMatch(/^Barbacoa .*11\.408,45 \(Lista .*12\.000,00\)$/);
  });

  it("cantidad N > 1: la fila junta las N unidades (su parte y su lista son de las N) y la suma sigue cerrando al centavo", () => {
    const r = repartoDelPrecioDeLaPromo(10000, [parte("Empanadas", 3, 3, { nombre: "Empanada", precioLista: 700 }), GASEOSA]);
    expect(r.tipo).toBe("ok");
    if (r.tipo !== "ok") return;
    expect(r.filas[0]).toMatchObject({ cantidad: 3, lista: importeDeLinea(3, 700) });
    expect(r.filas[0]!.reparto + r.filas[1]!.reparto).toBeCloseTo(10000, 2);
    expect(Math.round((r.filas[0]!.reparto + r.filas[1]!.reparto) * 100)).toBe(1000000);
    expect(textoDeLaFilaDelReparto(r.filas[0]!)).toMatch(/^3 × Empanada /);
  });

  it("un rango usa la cantidad MÁXIMA y lo avisa (usaMaximo)", () => {
    const r = repartoDelPrecioDeLaPromo(5000, [parte("Entradas", 0, 2, { nombre: "Provoleta", precioLista: 3000 }), GASEOSA]);
    expect(r.tipo).toBe("ok");
    if (r.tipo !== "ok") return;
    expect(r.filas[0]).toMatchObject({ cantidad: 2, lista: 6000 });
    expect(r.usaMaximo).toBe(true);
  });

  it("si ALGUNA parte no tiene producto disponible NO se reparte y se nombran las que faltan (no se estima: repartir solo entre las demás sobrestimaría)", () => {
    expect(repartoDelPrecioDeLaPromo(13500, [BARBACOA, parte("Postres", 1, 1, null)])).toEqual({ tipo: "incompleto", sinProducto: ["Postres"] });
    expect(repartoDelPrecioDeLaPromo(13500, [parte("Entrada", 1, 1, null), BARBACOA, parte("Postres", 1, 1, null)])).toEqual({ tipo: "incompleto", sinProducto: ["Entrada", "Postres"] });
  });

  it("sin ninguna parte con producto disponible: «sin-productos» (no se inventa un precio)", () => {
    expect(repartoDelPrecioDeLaPromo(13500, [parte("Platos", 1, 1, null), parte("Postres", 1, 1, null)])).toEqual({ tipo: "sin-productos" });
    expect(repartoDelPrecioDeLaPromo(13500, [])).toEqual({ tipo: "sin-productos" });
  });

  it("un precio bajo el piso de $ 0,01 por unidad devuelve el MENSAJE del reparto (no se traga)", () => {
    const r = repartoDelPrecioDeLaPromo(0.01, [BARBACOA, GASEOSA]);
    expect(r.tipo).toBe("error");
    if (r.tipo !== "error") return;
    expect(r.mensaje).toMatch(/no alcanza el piso/);
  });

  it("el precio de la promo en cero tampoco se reparte: mensaje del reparto", () => {
    const r = repartoDelPrecioDeLaPromo(0, [BARBACOA]);
    expect(r).toMatchObject({ tipo: "error", mensaje: "El precio de la promo tiene que ser mayor que cero." });
  });

  it("dos partes con el MISMO producto no se mezclan (una fila cada una)", () => {
    const r = repartoDelPrecioDeLaPromo(3000, [parte("Plato 1", 1, 1, { nombre: "Milanesa", precioLista: 2000 }), parte("Plato 2", 1, 1, { nombre: "Milanesa", precioLista: 2000 })]);
    expect(r.tipo).toBe("ok");
    if (r.tipo !== "ok") return;
    expect(r.filas.map((f) => f.reparto)).toEqual([1500, 1500]);
  });
});
