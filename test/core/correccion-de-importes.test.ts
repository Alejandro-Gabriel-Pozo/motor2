import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { IMPORTE_MAXIMO_EN_CENTAVOS, evaluarCorreccionDeImportes, mensajeCorreccionDeImportes, type RenglonVigente } from "../../src/core/compras/correccion-de-importes";

/**
 * Reglas puras de la corrección de importes por ejemplar (etapa C0, docs/diseno-correccion-de-compras-2026-11-06.md): el stock NO se toca (mismas cantidades, productos, secciones y lotes), el dinero va en centavos
 * enteros y el precio por unidad es el de la carga (importe ÷ cantidad, 4 decimales).
 */
const renglon = (n: number, precioTotal: number, cantidad = 24): RenglonVigente => ({
  movimientoId: `m${n}`,
  productoId: `p${n}`,
  productoNombre: `Producto ${n}`,
  seccionId: "s1",
  loteVencimiento: null,
  cantidad,
  detalle: `${cantidad} unidad`,
  precioTotal,
});

describe("evaluarCorreccionDeImportes", () => {
  it("corrige un importe: total nuevo, precio por unidad calculado y el resto del renglón igual", () => {
    const r = evaluarCorreccionDeImportes([renglon(1, 144000), renglon(2, 72000, 48)], [{ movimientoId: "m1", importeEnCentavos: 15_000_000 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalAntesEnCentavos).toBe(21_600_000);
    expect(r.totalDespuesEnCentavos).toBe(22_200_000);
    expect(r.cambios).toEqual([{ movimientoId: "m1", productoNombre: "Producto 1", anteriorEnCentavos: 14_400_000, nuevoEnCentavos: 15_000_000 }]);
    expect(r.lineas[0]).toMatchObject({ precioTotal: 150000, precioPorUnidadStock: 6250, cantidad: 24, cambio: true });
    expect(r.lineas[1]).toMatchObject({ precioTotal: 72000, precioPorUnidadStock: 1500, cantidad: 48, cambio: false });
  });

  it("completa un importe faltante ($0 = sin dato)", () => {
    const r = evaluarCorreccionDeImportes([renglon(1, 0, 20)], [{ movimientoId: "m1", importeEnCentavos: 150_000 }]);
    expect(r.ok && r.lineas[0]).toMatchObject({ precioTotal: 1500, precioPorUnidadStock: 75, cambio: true });
  });

  it("SIN_CAMBIOS si el importe pedido es el que ya tiene", () => {
    expect(evaluarCorreccionDeImportes([renglon(1, 144000)], [{ movimientoId: "m1", importeEnCentavos: 14_400_000 }])).toMatchObject({ ok: false, codigo: "SIN_CAMBIOS" });
  });

  it("rechaza lo inválido: renglón ajeno o repetido, importe cero, negativo, decimal o pasado del tope, y compra sin renglones", () => {
    const v = [renglon(1, 100)];
    expect(evaluarCorreccionDeImportes(v, [{ movimientoId: "otro", importeEnCentavos: 100 }])).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(evaluarCorreccionDeImportes(v, [{ movimientoId: "m1", importeEnCentavos: 100 }, { movimientoId: "m1", importeEnCentavos: 200 }])).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    for (const malo of [0, -5, 10.5, Number.NaN, IMPORTE_MAXIMO_EN_CENTAVOS + 1]) {
      expect(evaluarCorreccionDeImportes(v, [{ movimientoId: "m1", importeEnCentavos: malo }]), String(malo)).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    }
    expect(evaluarCorreccionDeImportes(v, [])).toMatchObject({ ok: false, codigo: "ENTRADA_INVALIDA" });
    expect(evaluarCorreccionDeImportes([], [{ movimientoId: "m1", importeEnCentavos: 100 }])).toMatchObject({ ok: false, codigo: "SIN_RENGLONES" });
  });

  it("propiedad: nunca toca el stock y el total es exacto en centavos", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ centavos: fc.integer({ min: 1, max: 5_000_000 }), cantidad: fc.integer({ min: 1, max: 500 }), nuevo: fc.option(fc.integer({ min: 1, max: 5_000_000 }), { nil: undefined }) }), { minLength: 1, maxLength: 8 }),
        (filas) => {
          const vigentes = filas.map((f, i) => renglon(i, f.centavos / 100, f.cantidad));
          const pedidos = filas.flatMap((f, i) => (f.nuevo === undefined ? [] : [{ movimientoId: `m${i}`, importeEnCentavos: f.nuevo }]));
          const r = evaluarCorreccionDeImportes(vigentes, pedidos);
          if (!r.ok) return pedidos.length === 0 || filas.every((f) => f.nuevo === undefined || f.nuevo === f.centavos);
          expect(r.lineas.map((l) => [l.movimientoId, l.productoId, l.seccionId, l.cantidad, l.detalle])).toEqual(vigentes.map((v) => [v.movimientoId, v.productoId, v.seccionId, v.cantidad, v.detalle]));
          const esperado = filas.reduce((s, f) => s + (f.nuevo ?? f.centavos), 0);
          expect(r.totalDespuesEnCentavos).toBe(esperado);
          expect(r.totalAntesEnCentavos).toBe(filas.reduce((s, f) => s + f.centavos, 0));
          return true;
        }
      )
    );
  });
});

describe("mensajeCorreccionDeImportes", () => {
  it("dice el importe de cada renglón y que la original queda en el historial", () => {
    expect(mensajeCorreccionDeImportes([{ movimientoId: "m1", productoNombre: "Cerveza", anteriorEnCentavos: 14_400_000, nuevoEnCentavos: 15_000_050 }], "A-00003-00004567")).toBe(
      "Factura A-00003-00004567 corregida: importe de Cerveza (de $144.000 a $150.000,50). La original queda en el historial."
    );
  });
});
