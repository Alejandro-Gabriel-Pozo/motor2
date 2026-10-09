import { describe, expect, it } from "vitest";
import { evaluarPosterioresAAnularVenta, evaluarPosterioresACancelarConteo } from "../../src/core/movimientos/anulaciones";
import { evaluarPosterioresAAnularCompra } from "../../src/core/compras/anulacion";

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

describe("evaluarPosterioresACancelarConteo y evaluarPosterioresAAnularCompra (D7, M-2 y M-3)", () => {
  const donde = [{ productoNombre: "Harina", seccionNombre: "Depósito" }, { productoNombre: "Queso", seccionNombre: "Cocina" }];

  it("sin nada posterior, se puede cancelar el conteo y anular la compra", () => {
    expect(evaluarPosterioresACancelarConteo([])).toEqual({ ok: true });
    expect(evaluarPosterioresAAnularCompra([])).toEqual({ ok: true });
  });

  it("cancelar un conteo con algo posterior se rechaza con CONTEO_POSTERIOR: nombra producto y sección y manda a corregir con un ajuste", () => {
    const r = evaluarPosterioresACancelarConteo(donde);
    expect(r).toEqual({
      ok: false,
      motivo: "CONTEO_POSTERIOR",
      mensaje:
        "No se puede cancelar este conteo: después de hacerse hubo otro conteo físico de Harina (Depósito), Queso (Cocina), y cancelarlo ahora desharía a ciegas un stock que ya se reconcilió. Para corregirlo, cargá un Ajuste de stock (Movimientos → Ajuste) por la diferencia: suma si en el sistema falta mercadería y resta si sobra. Si no ves esa opción, pedile a un administrador que lo cargue.",
    });
  });

  it("anular una compra con un conteo posterior se rechaza con CONTEO_POSTERIOR y la misma estructura de texto que la venta, nombrando a la compra", () => {
    const r = evaluarPosterioresAAnularCompra(donde);
    expect(r).toEqual({
      ok: false,
      motivo: "CONTEO_POSTERIOR",
      mensaje:
        "No se puede anular esta compra: después de hacerse hubo un conteo físico de Harina (Depósito), Queso (Cocina), y anularla ahora desharía a ciegas un stock que ya se reconcilió. Para corregirlo, cargá un Ajuste de stock (Movimientos → Ajuste) por la diferencia: suma si en el sistema falta mercadería y resta si sobra. Si no ves esa opción, pedile a un administrador que lo cargue.",
    });
  });
});
