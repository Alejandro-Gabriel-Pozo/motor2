import { describe, expect, it } from "vitest";
import { evaluarPosterioresAAnularVenta } from "../../src/core/movimientos/anulaciones";

/** Módulo puro: sin base de datos. S-03 (O.52), D7 decidida por el dueño el 2026-10-08: el caso con filas está en test/casos-de-uso/anular-venta.test.ts. */
describe("evaluarPosterioresAAnularVenta (D7)", () => {
  it("sin nada posterior, se puede anular", () => {
    expect(evaluarPosterioresAAnularVenta({ controlesOAjustes: [], pagosAConsignantes: [] })).toEqual({ ok: true });
  });

  it("con un conteo/ajuste posterior se rechaza con CONTEO_POSTERIOR, nombra producto y sección y manda a corregir con un ajuste", () => {
    const r = evaluarPosterioresAAnularVenta({ controlesOAjustes: [{ productoNombre: "Harina", seccionNombre: "Depósito" }, { productoNombre: "Queso", seccionNombre: "Cocina" }], pagosAConsignantes: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("CONTEO_POSTERIOR");
    expect(r.mensaje).toContain("Harina (Depósito), Queso (Cocina)");
    expect(r.mensaje).toContain("ajuste de stock");
  });

  it("con un pago al consignante posterior se rechaza con PAGO_CONSIGNANTE_POSTERIOR, nombra al consignante y manda a corregir con un ajuste", () => {
    const r = evaluarPosterioresAAnularVenta({ controlesOAjustes: [], pagosAConsignantes: ["Bodega Don Pepe"] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("PAGO_CONSIGNANTE_POSTERIOR");
    expect(r.mensaje).toContain("Bodega Don Pepe");
    expect(r.mensaje).toContain("ajuste");
  });

  it("con las dos cosas gana el conteo (un solo motivo por rechazo)", () => {
    const r = evaluarPosterioresAAnularVenta({ controlesOAjustes: [{ productoNombre: "Harina", seccionNombre: "Depósito" }], pagosAConsignantes: ["Bodega Don Pepe"] });
    expect(r).toMatchObject({ ok: false, motivo: "CONTEO_POSTERIOR" });
  });
});
