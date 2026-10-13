import { describe, expect, it } from "vitest";
import { guardComandoAgregarItems, MAXIMO_OPCIONES_POR_ITEM } from "../../../../src/core/features/cuentas/cuenta-pedido.guard";

/**
 * GO-2b (ADR-030): la forma de las `opciones` de cada ítem en el guard de «agregar ítems». Va AL FINAL (no cambia qué mensaje gana con dos fallas a la vez), exige la
 * versión que vio el mozo, topea la lista por ítem y OMITE la lista vacía (la huella de un pedido sin opciones es la de siempre). Un ítem sin `opciones` pasa tal cual.
 */
const op = (extra: Record<string, unknown> = {}) => ({ opcionId: "op-1", cantidad: 1, versionDeOpcionId: "v-1", ...extra });

describe("guardComandoAgregarItems con opciones", () => {
  it("un ítem sin opciones pasa como el MISMO objeto; con `opciones: []` pasa sin la clave", () => {
    const sinOpciones = { productoId: "p", cantidad: 1 };
    const r = guardComandoAgregarItems({ cuentaId: "c", items: [sinOpciones, { productoId: "q", cantidad: 2, opciones: [] }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.items[0]).toBe(sinOpciones);
    expect(r.valor.items[1]).toEqual({ productoId: "q", cantidad: 2 });
    expect(r.valor.items[1]).not.toHaveProperty("opciones");
  });

  it("las opciones válidas pasan con solo sus tres campos (sin nada de más del cliente, como un precio)", () => {
    const r = guardComandoAgregarItems({ cuentaId: "c", items: [{ productoId: "p", cantidad: 1, opciones: [op({ precio: 1 }), op({ opcionId: "op-2", cantidad: 3 })] }] });
    expect(r).toEqual({ ok: true, valor: { cuentaId: "c", items: [{ productoId: "p", cantidad: 1, opciones: [op(), op({ opcionId: "op-2", cantidad: 3 })] }], promos: [] } });
  });

  it.each([
    ["no es una lista", "x"],
    ["un elemento que no es objeto", [null]],
    ["sin versión", [{ opcionId: "op-1", cantidad: 1 }]],
    ["versión vacía", [op({ versionDeOpcionId: "" })]],
    ["opcionId que no es texto", [op({ opcionId: 7 })]],
  ])("forma rota (%s): «formato»", (_caso, opciones) => {
    expect(guardComandoAgregarItems({ cuentaId: "c", items: [{ productoId: "p", cantidad: 1, opciones }] })).toEqual({ ok: false, codigo: "formato", mensaje: "Las opciones elegidas no son válidas: volvé a elegirlas." });
  });

  it.each([0, 11, 1.5, "2"])("cantidad %j fuera de rango o no entera: «rango»", (cantidad) => {
    expect(guardComandoAgregarItems({ cuentaId: "c", items: [{ productoId: "p", cantidad: 1, opciones: [op({ cantidad })] }] })).toMatchObject({ ok: false, codigo: "rango" });
  });

  it(`más de ${MAXIMO_OPCIONES_POR_ITEM} opciones en un ítem: «rango»`, () => {
    const opciones = Array.from({ length: MAXIMO_OPCIONES_POR_ITEM + 1 }, (_, i) => op({ opcionId: `op-${i}` }));
    expect(guardComandoAgregarItems({ cuentaId: "c", items: [{ productoId: "p", cantidad: 1, opciones }] })).toMatchObject({ ok: false, codigo: "rango" });
  });

  it("los chequeos de siempre ganan: lista vacía, cuenta que no es texto y clave inválida se responden antes que unas opciones rotas", () => {
    expect(guardComandoAgregarItems({ cuentaId: 5, items: [{ productoId: "p", cantidad: 1, opciones: "x" }] })).toMatchObject({ ok: false, mensaje: "No se encontró esa cuenta en esta sucursal." });
    expect(guardComandoAgregarItems({ cuentaId: "c", items: [{ productoId: "p", cantidad: 1, opciones: "x" }], claveIdempotencia: "no-uuid" })).toMatchObject({ ok: false, mensaje: "Clave de reintento inválida." });
  });
});
