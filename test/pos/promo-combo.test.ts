import { describe, expect, it } from "vitest";
import { importeDeLinea } from "../../src/core/moneda";
import {
  componentesDeEleccion,
  precioMinimoPromo,
  prorratearPrecioPromo,
  totalProrrateado,
  validarEleccionPromo,
  type ComponentePromoElegido,
  type CupoPromoDefinicion,
  type EleccionDeCupo,
} from "../../src/core/pos/promo-combo";

/**
 * Tests puros de src/core/pos/promo-combo.ts (sin base) — Task #16, docs/plan-promo-combo-2026-09-26.md.
 */

function cupo(over: Partial<CupoPromoDefinicion> = {}): CupoPromoDefinicion {
  return {
    seccionCartaId: "sec-entradas",
    nombreSeccion: "Entradas",
    cantidadMinima: 1,
    cantidadMaximaCupo: 2,
    elegibles: new Set(["empanada-carne", "empanada-jyq"]),
    ...over,
  };
}

describe("promo-combo — validarEleccionPromo (D1)", () => {
  it("acepta una elección dentro de mínimo y máximo, con productos elegibles", () => {
    const elecciones: EleccionDeCupo[] = [{ seccionCartaId: "sec-entradas", elegidos: [{ productoId: "empanada-carne", cantidad: 2 }] }];
    expect(validarEleccionPromo([cupo()], elecciones)).toEqual({ ok: true });
  });

  it("rechaza por debajo del mínimo (D1)", () => {
    const elecciones: EleccionDeCupo[] = [{ seccionCartaId: "sec-entradas", elegidos: [] }];
    const r = validarEleccionPromo([cupo({ cantidadMinima: 1 })], elecciones);
    expect(r.ok).toBe(false);
  });

  it("mínimo 0 por defecto (D1): un cupo puede quedar vacío", () => {
    const elecciones: EleccionDeCupo[] = [{ seccionCartaId: "sec-entradas", elegidos: [] }];
    expect(validarEleccionPromo([cupo({ cantidadMinima: 0 })], elecciones)).toEqual({ ok: true });
  });

  it("rechaza por encima del máximo", () => {
    const elecciones: EleccionDeCupo[] = [{ seccionCartaId: "sec-entradas", elegidos: [{ productoId: "empanada-carne", cantidad: 3 }] }];
    const r = validarEleccionPromo([cupo({ cantidadMaximaCupo: 2 })], elecciones);
    expect(r.ok).toBe(false);
  });

  it("rechaza un producto que no pertenece a la sección del cupo (D5)", () => {
    const elecciones: EleccionDeCupo[] = [{ seccionCartaId: "sec-entradas", elegidos: [{ productoId: "milanesa-napo", cantidad: 1 }] }];
    const r = validarEleccionPromo([cupo()], elecciones);
    expect(r.ok).toBe(false);
  });

  it("rechaza una cantidad no entera o ≤ 0", () => {
    const conFraccion: EleccionDeCupo[] = [{ seccionCartaId: "sec-entradas", elegidos: [{ productoId: "empanada-carne", cantidad: 1.5 }] }];
    expect(validarEleccionPromo([cupo()], conFraccion).ok).toBe(false);
    const conCero: EleccionDeCupo[] = [{ seccionCartaId: "sec-entradas", elegidos: [{ productoId: "empanada-carne", cantidad: 0 }] }];
    expect(validarEleccionPromo([cupo()], conCero).ok).toBe(false);
  });

  it("valida TODOS los cupos, no solo el primero", () => {
    const cupos = [cupo({ seccionCartaId: "sec-entradas", nombreSeccion: "Entradas" }), cupo({ seccionCartaId: "sec-postres", nombreSeccion: "Postres", elegibles: new Set(["flan"]) })];
    const elecciones: EleccionDeCupo[] = [
      { seccionCartaId: "sec-entradas", elegidos: [{ productoId: "empanada-carne", cantidad: 1 }] },
      { seccionCartaId: "sec-postres", elegidos: [] }, // por debajo del mínimo (1)
    ];
    expect(validarEleccionPromo(cupos, elecciones).ok).toBe(false);
  });

  it("suma varios productos DISTINTOS del mismo cupo contra el máximo", () => {
    const elecciones: EleccionDeCupo[] = [
      { seccionCartaId: "sec-entradas", elegidos: [{ productoId: "empanada-carne", cantidad: 1 }, { productoId: "empanada-jyq", cantidad: 2 }] },
    ];
    expect(validarEleccionPromo([cupo({ cantidadMaximaCupo: 2 })], elecciones).ok).toBe(false);
    expect(validarEleccionPromo([cupo({ cantidadMaximaCupo: 3 })], elecciones).ok).toBe(true);
  });
});

describe("promo-combo — componentesDeEleccion", () => {
  it("aplana todos los cupos en una sola lista", () => {
    const elecciones: EleccionDeCupo[] = [
      { seccionCartaId: "sec-entradas", elegidos: [{ productoId: "empanada-carne", cantidad: 2 }] },
      { seccionCartaId: "sec-postres", elegidos: [{ productoId: "flan", cantidad: 1 }] },
    ];
    expect(componentesDeEleccion(elecciones)).toEqual([
      { productoId: "empanada-carne", cantidad: 2 },
      { productoId: "flan", cantidad: 1 },
    ]);
  });
});

describe("promo-combo — precioMinimoPromo", () => {
  it("$0,01 por cada unidad elegida, sumando todos los componentes", () => {
    expect(precioMinimoPromo([{ cantidad: 2 }, { cantidad: 3 }])).toBe(0.05);
    expect(precioMinimoPromo([])).toBe(0);
  });
});

describe("promo-combo — prorratearPrecioPromo (D3)", () => {
  it("reparte proporcional al precio de carta cuando divide exacto", () => {
    // 1 empanada ($1000 carta) + 1 milanesa ($3000 carta) = $4000 de carta, promo $2000 → 500 / 1500.
    const componentes: ComponentePromoElegido[] = [
      { productoId: "empanada-carne", cantidad: 1, precioCarta: 1000 },
      { productoId: "milanesa-napo", cantidad: 1, precioCarta: 3000 },
    ];
    const r = prorratearPrecioPromo(2000, componentes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filas).toEqual([
      { productoId: "empanada-carne", cantidad: 1, precioUnitario: 500 },
      { productoId: "milanesa-napo", cantidad: 1, precioUnitario: 1500 },
    ]);
  });

  it("la suma de importeDeLinea de las filas da EXACTO el precio de la promo, con montos difíciles de dividir", () => {
    const componentes: ComponentePromoElegido[] = [
      { productoId: "a", cantidad: 3, precioCarta: 1234.55 },
      { productoId: "b", cantidad: 2, precioCarta: 987.33 },
      { productoId: "c", cantidad: 1, precioCarta: 501 },
    ];
    const r = prorratearPrecioPromo(6543.21, componentes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(totalProrrateado(r.filas)).toBe(6543.21);
    // Verificación directa, no solo vía el helper del propio módulo.
    const suma = r.filas.reduce((s, f) => s + importeDeLinea(f.cantidad, f.precioUnitario), 0);
    expect(Math.round(suma * 100) / 100).toBe(6543.21);
  });

  it("piso de $0,01 por unidad: nunca hay una fila con precioUnitario < 0,01, ni con un componente muy barato entre otros caros", () => {
    const componentes: ComponentePromoElegido[] = [
      { productoId: "carisimo", cantidad: 1, precioCarta: 100000 },
      { productoId: "casigratis", cantidad: 1, precioCarta: 0.01 },
    ];
    const r = prorratearPrecioPromo(10, componentes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const f of r.filas) expect(f.precioUnitario).toBeGreaterThanOrEqual(0.01);
    expect(totalProrrateado(r.filas)).toBe(10);
  });

  it("caso borde: si la suma a la carta es 0, reparte en partes iguales", () => {
    const componentes: ComponentePromoElegido[] = [
      { productoId: "a", cantidad: 1, precioCarta: 0 },
      { productoId: "b", cantidad: 1, precioCarta: 0 },
    ];
    const r = prorratearPrecioPromo(10, componentes);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filas).toEqual([
      { productoId: "a", cantidad: 1, precioUnitario: 5 },
      { productoId: "b", cantidad: 1, precioUnitario: 5 },
    ]);
  });

  it("rechaza cuando el precio de la promo es menor que 0,01 × unidades", () => {
    const componentes: ComponentePromoElegido[] = [{ productoId: "a", cantidad: 5, precioCarta: 100 }];
    const r = prorratearPrecioPromo(0.04, componentes); // hacen falta 0,05 para 5 unidades
    expect(r.ok).toBe(false);
  });

  it("rechaza precio de promo ≤ 0 o no numérico", () => {
    const componentes: ComponentePromoElegido[] = [{ productoId: "a", cantidad: 1, precioCarta: 100 }];
    expect(prorratearPrecioPromo(0, componentes).ok).toBe(false);
    expect(prorratearPrecioPromo(-5, componentes).ok).toBe(false);
    expect(prorratearPrecioPromo(Number.NaN, componentes).ok).toBe(false);
  });

  it("rechaza sin ningún componente", () => {
    expect(prorratearPrecioPromo(100, []).ok).toBe(false);
  });

  it("separación de unidades (D3): un componente con cantidad > 1 cuyo resto no divide exacto termina en dos filas del MISMO producto", () => {
    // 3 unidades del mismo producto, único componente: el excedente sobre el piso se reparte en partes iguales (repartirImporte,
    // pesos idénticos) — si no es múltiplo de 3 centavos, una o dos unidades se llevan 1 centavo más que las demás.
    const componentes: ComponentePromoElegido[] = [{ productoId: "empanada-carne", cantidad: 3, precioCarta: 1000 }];
    const r = prorratearPrecioPromo(10.01, componentes); // excedente sobre el piso ($9,98) no divide exacto entre 3
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filas.length).toBeGreaterThan(1);
    expect(r.filas.every((f) => f.productoId === "empanada-carne")).toBe(true);
    expect(r.filas.reduce((s, f) => s + f.cantidad, 0)).toBe(3);
    expect(totalProrrateado(r.filas)).toBe(10.01);
  });

  it("determinismo: dos corridas con el mismo pedido dan SIEMPRE el mismo resultado", () => {
    const componentes: ComponentePromoElegido[] = [
      { productoId: "a", cantidad: 3, precioCarta: 333.33 },
      { productoId: "b", cantidad: 2, precioCarta: 111.11 },
    ];
    const r1 = prorratearPrecioPromo(999.99, componentes);
    const r2 = prorratearPrecioPromo(999.99, componentes);
    expect(r1).toEqual(r2);
  });

  it("un componente inválido (cantidad no entera) se rechaza antes de prorratear nada", () => {
    const componentes: ComponentePromoElegido[] = [{ productoId: "a", cantidad: 1.5, precioCarta: 100 }];
    expect(prorratearPrecioPromo(100, componentes).ok).toBe(false);
  });
});
