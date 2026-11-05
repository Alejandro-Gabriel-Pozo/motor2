import { describe, expect, it } from "vitest";
import { armarComandas, type ItemParaComanda } from "../../src/core/pos/comanda";
import { documentoDeReimpresion } from "../../src/core/pos/impresion";
import { nombreDeLineaConfigurada, type FotoParaElNombre } from "../../src/core/opciones/nombre-de-la-linea";

/** Comanda de cocina (KOT) por envío (src/core/pos/comanda.ts, docs/plan-imprimir-comanda-y-ticket-2026-09-25.md B1): núcleo puro, sin precios. */

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

/**
 * «Nombre en la carta» (2026-11-04): la COMANDA de cocina (KOT) no se toca. Ahí tiene que verse lo operativo: qué se cocina (la opción elegida, con lo incluido en el detalle), para poder controlar que «no se sacó
 * nalga cuando era bife». El nombre de la carta es solo de cara al cliente: la línea sale de `nombreDeLinea ?? productoNombre` y `detalleDeLinea`, y un `nombreEnCarta` que llegara de más no entra. El consumo de
 * stock de cada opción elegida está cubierto por `test/core/opciones/consumo-de-linea-configurada.test.ts` (cada opción consume SU receta; un reemplazo saca lo reemplazado y no otra cosa).
 */
describe("armarComandas: el nombre en la carta no entra a la comanda", () => {
  const fotos = (...f: [string, string][]): FotoParaElNombre[] => f.map(([tipoGrupo, nombreOpcion]) => ({ tipoGrupo, nombreOpcion, cantidad: 1, grupo: { prefijoEnCarta: null }, opcion: { esNinguna: false } }));

  it("producto directo: «Plato del día» con Proteína = Bife de chorizo sale como «Plato del día bife de chorizo» con lo incluido en el detalle; el nombre de la carta no aparece", () => {
    const { nombre, detalle } = nombreDeLineaConfigurada("Plato del día", false, fotos(["VARIANTE", "Bife de chorizo"], ["INCLUIDA", "Puré de papa"]));
    const entrada = { ...item("a", "Plato del día", 1, "Juan"), nombreDeLinea: nombre, detalleDeLinea: detalle, nombreEnCarta: "La Parrillada" };
    const [comanda] = armarComandas([{ numero: 1, items: [entrada] }], "Ana");
    expect(comanda.lineas).toEqual([{ itemId: "a", producto: "Plato del día bife de chorizo", cantidad: 1, detalle: "puré de papa" }]);
    expect(JSON.stringify(comanda)).not.toContain("La Parrillada");
  });

  it("base: el plato sale del rótulo de la opción de la medida («Bife de chorizo a la criolla»), con lo incluido (nalga · puré de papa) en el detalle, y no con el nombre interno del producto ni con el de la carta", () => {
    const { nombre, detalle } = nombreDeLineaConfigurada("BIFE-", true, fotos(["MEDIDA", "Bife de chorizo a la criolla"], ["INCLUIDA", "Nalga"], ["INCLUIDA", "Puré de papa"]));
    const entrada = { ...item("b", "BIFE-", 2, "Juan"), nombreDeLinea: nombre, detalleDeLinea: detalle, nombreEnCarta: "El Bife" };
    const [comanda] = armarComandas([{ numero: 1, items: [entrada] }], "Ana");
    expect(comanda.lineas).toEqual([{ itemId: "b", producto: "Bife de chorizo a la criolla", cantidad: 2, detalle: "nalga · puré de papa" }]);
    expect(JSON.stringify(comanda)).not.toContain("El Bife");
  });
});
