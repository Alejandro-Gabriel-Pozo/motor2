import { describe, expect, it } from "vitest";
import { guardComandoAceptarParteDeFactura, guardComandoAnularFacturaProveedor, guardComandoRegistrarFacturaProveedor } from "@/core/features/compras/factura-proveedor.guard";
import { mediodiaDelDia, ZONA_ARGENTINA } from "@/core/tiempo/zona-horaria";

/**
 * E3a, paso 2: el formato de los tres comandos de la factura de proveedor (clave obligatoria, número obligatorio al repartir con otras sucursales, sección de la parte propia, reparto bien formado
 * y motivo de la anulación).
 *
 * Mutaciones (anotadas en el commit): volver opcional la clave (`claveObligatoria` acepta vacío) → rojo «sin clave»; quitar la exigencia del número al repartir → rojo «número obligatorio»;
 * quitar el chequeo de sucursal repetida → rojo «sucursal dos veces»; aceptar motivo vacío → rojo «motivo».
 */
const AHORA = new Date("2026-10-28T15:00:00.000Z");
const HOY = mediodiaDelDia("2026-10-28", ZONA_ARGENTINA);
const CLAVE = "3f0b8f5e-2c1d-4f6a-9b7e-1a2b3c4d5e6f";
const S3 = "suc_3";

const base = (extra: Record<string, unknown> = {}) => ({
  fecha: HOY,
  proveedorId: "prov",
  nroFactura: "0001-00000077",
  seccionId: "sec",
  items: [{ productoId: "p", cantidad: 3, precioTotal: 300 }],
  reparto: { modo: "IMPORTE", partes: [{ sucursalId: S3, valor: 200 }, { sucursalId: "suc_4", valor: 100 }] },
  claveIdempotencia: CLAVE,
  ...extra,
});

describe("guardComandoRegistrarFacturaProveedor", () => {
  it("acepta una factura bien formada", () => expect(guardComandoRegistrarFacturaProveedor(base(), AHORA, S3).ok).toBe(true));
  it("sin clave o con clave inválida se rechaza (decisión 8)", () => {
    expect(guardComandoRegistrarFacturaProveedor(base({ claveIdempotencia: undefined }), AHORA, S3)).toMatchObject({ ok: false, mensaje: "Falta la clave de reintento: recargá la pantalla." });
    expect(guardComandoRegistrarFacturaProveedor(base({ claveIdempotencia: "x" }), AHORA, S3)).toMatchObject({ ok: false, mensaje: "Clave de reintento inválida." });
  });
  it("número obligatorio cuando hay partes de otra sucursal (D10); opcional si todo queda en la propia", () => {
    expect(guardComandoRegistrarFacturaProveedor(base({ nroFactura: "" }), AHORA, S3)).toMatchObject({ ok: false, mensaje: expect.stringContaining("hace falta su número") });
    expect(guardComandoRegistrarFacturaProveedor(base({ nroFactura: "", reparto: { modo: "PORCENTAJE", partes: [{ sucursalId: S3, valor: 100 }] } }), AHORA, S3).ok).toBe(true);
  });
  it("la sección es obligatoria solo si la sucursal que carga tiene parte", () => {
    expect(guardComandoRegistrarFacturaProveedor(base({ seccionId: "" }), AHORA, S3)).toMatchObject({ ok: false, mensaje: expect.stringContaining("sección") });
    expect(guardComandoRegistrarFacturaProveedor(base({ seccionId: "", reparto: { modo: "IMPORTE", partes: [{ sucursalId: "suc_4", valor: 300 }] } }), AHORA, S3).ok).toBe(true);
  });
  it("reparto mal formado: sin modo, sin partes, sucursal dos veces, valor en cero", () => {
    expect(guardComandoRegistrarFacturaProveedor(base({ reparto: { partes: [] } }), AHORA, S3).ok).toBe(false);
    expect(guardComandoRegistrarFacturaProveedor(base({ reparto: { modo: "IMPORTE", partes: [] } }), AHORA, S3).ok).toBe(false);
    expect(guardComandoRegistrarFacturaProveedor(base({ reparto: { modo: "IMPORTE", partes: [{ sucursalId: S3, valor: 1 }, { sucursalId: S3, valor: 2 }] } }), AHORA, S3)).toMatchObject({ ok: false, mensaje: "Una sucursal aparece dos veces en el reparto." });
    expect(guardComandoRegistrarFacturaProveedor(base({ reparto: { modo: "IMPORTE", partes: [{ sucursalId: S3, valor: 0 }] } }), AHORA, S3).ok).toBe(false);
  });
  it("sin proveedor, sin renglones o con fecha imposible se rechaza", () => {
    expect(guardComandoRegistrarFacturaProveedor(base({ proveedorId: "" }), AHORA, S3).ok).toBe(false);
    expect(guardComandoRegistrarFacturaProveedor(base({ items: [] }), AHORA, S3).ok).toBe(false);
    expect(guardComandoRegistrarFacturaProveedor(base({ fecha: new Date("2026-11-30T15:00:00Z") }), AHORA, S3).ok).toBe(false);
  });
});

describe("guardComandoAceptarParteDeFactura y guardComandoAnularFacturaProveedor", () => {
  it("aceptar exige parte, sección, fecha válida y clave", () => {
    expect(guardComandoAceptarParteDeFactura({ parteId: "p", seccionId: "s", fechaStock: HOY, claveIdempotencia: CLAVE }, AHORA).ok).toBe(true);
    expect(guardComandoAceptarParteDeFactura({ parteId: "p", seccionId: "", fechaStock: HOY, claveIdempotencia: CLAVE }, AHORA).ok).toBe(false);
    expect(guardComandoAceptarParteDeFactura({ parteId: "p", seccionId: "s", fechaStock: HOY }, AHORA)).toMatchObject({ ok: false, mensaje: "Falta la clave de reintento: recargá la pantalla." });
  });
  it("anular exige motivo (1 a 200) y clave", () => {
    expect(guardComandoAnularFacturaProveedor({ facturaId: "f", motivo: "  error de carga ", claveIdempotencia: CLAVE })).toEqual({ ok: true, valor: { facturaId: "f", motivo: "error de carga", claveIdempotencia: CLAVE } });
    expect(guardComandoAnularFacturaProveedor({ facturaId: "f", motivo: "   ", claveIdempotencia: CLAVE })).toMatchObject({ ok: false, mensaje: "Escribí el motivo de la anulación." });
    expect(guardComandoAnularFacturaProveedor({ facturaId: "f", motivo: "x".repeat(201), claveIdempotencia: CLAVE }).ok).toBe(false);
    expect(guardComandoAnularFacturaProveedor({ facturaId: "f", motivo: "ok" }).ok).toBe(false);
  });
});
