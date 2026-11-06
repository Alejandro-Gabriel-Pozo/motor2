import { describe, expect, it } from "vitest";
import { guardComandoCorregirImportesDeCompra } from "../../../../src/core/features/compras/compra.guard";

const CLAVE = "123e4567-e89b-42d3-a456-426614174000";
const base = { operacionId: "op1", importes: [{ movimientoId: "m1", importeEnCentavos: 15_000_000 }], motivoId: "mot1", claveIdempotencia: CLAVE };

describe("guardComandoCorregirImportesDeCompra", () => {
  it("acepta un comando completo y recorta el detalle", () => {
    const r = guardComandoCorregirImportesDeCompra({ ...base, detalleMotivo: "  era 150 mil  " });
    expect(r).toMatchObject({ ok: true, valor: { operacionId: "op1", motivoId: "mot1", detalleMotivo: "era 150 mil", claveIdempotencia: CLAVE } });
  });

  it("el detalle vacío es null", () => {
    expect(guardComandoCorregirImportesDeCompra({ ...base, detalleMotivo: "   " })).toMatchObject({ ok: true, valor: { detalleMotivo: null } });
  });

  it("rechaza lo que falta o está mal: clave, operación, motivo, importes y detalle largo", () => {
    expect(guardComandoCorregirImportesDeCompra({ ...base, claveIdempotencia: undefined }).ok).toBe(false);
    expect(guardComandoCorregirImportesDeCompra({ ...base, claveIdempotencia: "no-es-uuid" }).ok).toBe(false);
    expect(guardComandoCorregirImportesDeCompra({ ...base, operacionId: 5 }).ok).toBe(false);
    expect(guardComandoCorregirImportesDeCompra({ ...base, motivoId: "  " }).ok).toBe(false);
    expect(guardComandoCorregirImportesDeCompra({ ...base, importes: [] }).ok).toBe(false);
    expect(guardComandoCorregirImportesDeCompra({ ...base, importes: [{ movimientoId: "m1", importeEnCentavos: 10.5 }] }).ok).toBe(false);
    expect(guardComandoCorregirImportesDeCompra({ ...base, importes: [{ movimientoId: "m1", importeEnCentavos: 0 }] }).ok).toBe(false);
    expect(guardComandoCorregirImportesDeCompra({ ...base, importes: [{ importeEnCentavos: 100 }] }).ok).toBe(false);
    expect(guardComandoCorregirImportesDeCompra({ ...base, detalleMotivo: "x".repeat(201) }).ok).toBe(false);
    expect(guardComandoCorregirImportesDeCompra(null).ok).toBe(false);
  });
});
