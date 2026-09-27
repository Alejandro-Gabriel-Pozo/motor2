import { describe, expect, it } from "vitest";
import { armarComandas, documentoDeReimpresion, type ItemParaComanda } from "../../src/core/pos/comanda";

/** Comanda de cocina (KOT) por envío (src/core/pos/comanda.ts, docs/plan-imprimir-comanda-y-boleta-2026-09-25.md B1): núcleo puro, sin precios. */

type Espejo = ItemParaComanda["anulaciones"][number];

function item(id: string, productoNombre: string, restante: number, creadoPor: string | null, anulaciones: Espejo[] = [], promoTitulo: string | null = null): ItemParaComanda & { precioUnitario: number } {
  // `precioUnitario` viene como en la página (ItemDeCuenta): la comanda no tiene que dejarlo pasar.
  return { id, productoNombre, restante, creadoPor, anulaciones, promoTitulo, precioUnitario: 9000 };
}

describe("armarComandas", () => {
  it("sin anulaciones: una línea por ítem con su cantidad, «Tomó» con el autor y ningún bloque de anulado", () => {
    const [comanda] = armarComandas([{ numero: 1, items: [item("a", "Milanesa", 2, "Juan"), item("b", "Flan", 1, "Juan")] }], "Ana");
    expect(comanda).toEqual({
      numero: 1,
      itemIds: ["a", "b"],
      tomo: ["Juan"],
      lineas: [
        { itemId: "a", producto: "Milanesa", cantidad: 2 },
        { itemId: "b", producto: "Flan", cantidad: 1 },
      ],
      anulaciones: [],
    });
  });

  it("anulación parcial: la línea lleva lo vigente y la anulación su cantidad en positivo, el motivo, quién y cuánto quedó", () => {
    const [comanda] = armarComandas([{ numero: 2, items: [item("a", "Milanesa", 2, "Juan", [{ id: "e1", cantidad: -1, motivoAnulacion: "Pidió una menos", creadoPor: "Ana" }])] }], "Juan");
    expect(comanda.lineas).toEqual([{ itemId: "a", producto: "Milanesa", cantidad: 2 }]);
    expect(comanda.anulaciones).toEqual([{ id: "e1", itemId: "a", producto: "Milanesa", cantidad: 1, motivo: "Pidió una menos", por: "Ana", quedan: 2 }]);
  });

  it("dos anulaciones del mismo ítem: cada una dice lo que quedó después de ella", () => {
    const [comanda] = armarComandas(
      [
        {
          numero: 1,
          items: [
            item("a", "Empanada", 0.5, "Juan", [
              { id: "e1", cantidad: -1, motivoAnulacion: "Una menos", creadoPor: "Ana" },
              { id: "e2", cantidad: -1.5, motivoAnulacion: "Otra", creadoPor: "Ana" },
            ]),
          ],
        },
      ],
      "Juan"
    );
    expect(comanda.anulaciones.map((a) => [a.id, a.cantidad, a.quedan])).toEqual([
      ["e1", 1, 2],
      ["e2", 1.5, 0.5],
    ]);
  });

  it("anulación total: el ítem sale de las líneas (no se prepara) pero sigue en `itemIds` y en el bloque de anulado", () => {
    const [comanda] = armarComandas(
      [{ numero: 1, items: [item("a", "Flan", 0, "Juan", [{ id: "e1", cantidad: -1, motivoAnulacion: "No quiso postre", creadoPor: "Ana" }]), item("b", "Milanesa", 1, "Juan")] }],
      "Juan"
    );
    expect(comanda.itemIds).toEqual(["a", "b"]);
    expect(comanda.lineas).toEqual([{ itemId: "b", producto: "Milanesa", cantidad: 1 }]);
    expect(comanda.anulaciones).toEqual([{ id: "e1", itemId: "a", producto: "Flan", cantidad: 1, motivo: "No quiso postre", por: "Ana", quedan: 0 }]);
  });

  it("«Tomó»: los autores distintos del envío, en orden de aparición; sin ninguno registrado, el mozo de la cuenta", () => {
    const comandas = armarComandas(
      [
        { numero: 1, items: [item("a", "Milanesa", 1, "Juan"), item("b", "Flan", 1, "Ana"), item("c", "Pizza", 1, "Juan"), item("d", "Agua", 1, null)] },
        { numero: 2, items: [item("e", "Café", 1, null)] },
      ],
      "Pedro"
    );
    expect(comandas.map((c) => c.tomo)).toEqual([["Juan", "Ana"], ["Pedro"]]);
  });

  it("no deja pasar ningún precio, aunque el ítem de entrada lo traiga", () => {
    const comandas = armarComandas([{ numero: 1, items: [item("a", "Milanesa", 1, "Juan", [{ id: "e1", cantidad: -1, motivoAnulacion: "x", creadoPor: "Ana" }])] }], "Juan");
    expect(JSON.stringify(comandas)).not.toMatch(/precio|9000/i);
  });

  /** Task #16 (promo-combo, docs/plan-promo-combo-2026-09-26.md, paso 10): la cocina ve la anotación de la promo, sin precios. */
  describe("promoTitulo (Task #16)", () => {
    it("un componente de promo lleva la anotación en su línea; un suelto no trae el campo (idéntico a antes)", () => {
      const [comanda] = armarComandas([{ numero: 1, items: [item("a", "Empanada", 2, "Juan", [], "Menú del día"), item("b", "Agua", 1, "Juan")] }], "Juan");
      expect(comanda.lineas).toEqual([
        { itemId: "a", producto: "Empanada", cantidad: 2, promoTitulo: "Menú del día" },
        { itemId: "b", producto: "Agua", cantidad: 1 },
      ]);
      expect(comanda.lineas[1]).not.toHaveProperty("promoTitulo");
    });

    it("una anulación de un componente de promo también lleva la anotación", () => {
      const [comanda] = armarComandas(
        [{ numero: 1, items: [item("a", "Empanada", 1, "Juan", [{ id: "e1", cantidad: -1, motivoAnulacion: "Se cayó la mesa", creadoPor: "Ana" }], "Menú del día")] }],
        "Juan"
      );
      expect(comanda.anulaciones).toEqual([{ id: "e1", itemId: "a", producto: "Empanada", cantidad: 1, motivo: "Se cayó la mesa", por: "Ana", quedan: 1, promoTitulo: "Menú del día" }]);
    });
  });
});

describe("documentoDeReimpresion", () => {
  it("la comanda del envío pedido, marcada como reimpresión; un envío que no existe no da documento", () => {
    const comandas = armarComandas([{ numero: 1, items: [item("a", "Milanesa", 1, "Juan")] }, { numero: 2, items: [item("b", "Flan", 1, "Juan")] }], "Juan");
    expect(documentoDeReimpresion(comandas, 2)).toEqual({ tipo: "reimpresion", comanda: comandas[1] });
    expect(documentoDeReimpresion(comandas, 3)).toBeNull();
  });
});
