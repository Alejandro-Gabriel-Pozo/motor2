import { describe, expect, it } from "vitest";
import { guardLineaCompra, guardNroFacturaCompra } from "../../../../src/core/features/compras/compra.guard";

/** Guard de la feature Compra/Devolución a proveedor (src/core/features/compras/compra.guard.ts): formato + normalización, puro. */

describe("guardLineaCompra", () => {
  const KG = { nombre: "kg", decimales: 3 };
  const UNIDAD = { nombre: "unidad", decimales: 0 };

  it("cantidad, precio y peso real válidos: pasan los tres, tal cual", () => {
    const r = guardLineaCompra("Harina", { cantidad: 8, precioTotal: 1024.36, pesoReal: 8.2 }, UNIDAD, KG);
    expect(r).toEqual({ ok: true, valor: { cantidad: 8, precioTotal: 1024.36, pesoReal: 8.2 } });
  });

  it("sin precio: se permite, queda en 0 (compra sin precio sigue permitida)", () => {
    const r = guardLineaCompra("Harina", { cantidad: 8, precioTotal: undefined, pesoReal: null }, UNIDAD, KG);
    expect(r).toEqual({ ok: true, valor: { cantidad: 8, precioTotal: 0, pesoReal: null } });
  });

  it("cantidad NaN: rechaza mencionando el producto, antes de mirar el precio", () => {
    const r = guardLineaCompra("Harina", { cantidad: Number.NaN, precioTotal: -5, pesoReal: null }, UNIDAD, KG);
    expect(r).toEqual({ ok: false, codigo: "formato", mensaje: `La cantidad de "Harina" no es un número válido.` });
  });

  it("cantidad 0 en una compra: se rechaza (no se saltea en silencio)", () => {
    const r = guardLineaCompra("Harina", { cantidad: 0, precioTotal: 100, pesoReal: null }, UNIDAD, KG);
    expect(r).toEqual({ ok: false, codigo: "cero", mensaje: `La cantidad de "Harina" tiene que ser mayor que cero.` });
  });

  it("2,5 en una unidad entera: se rechaza, no se redondea a 3", () => {
    const r = guardLineaCompra("Bolsas", { cantidad: 2.5, precioTotal: 100, pesoReal: null }, UNIDAD, KG);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.mensaje).toContain("entero");
  });

  it("precio negativo: rechaza (no se guarda como 0)", () => {
    const r = guardLineaCompra("Harina", { cantidad: 8, precioTotal: -5, pesoReal: null }, UNIDAD, KG);
    expect(r).toEqual({ ok: false, codigo: "negativo", mensaje: `El precio de "Harina" no puede ser negativo.` });
  });

  it("precio con más de 2 decimales: rechaza", () => {
    const r = guardLineaCompra("Harina", { cantidad: 8, precioTotal: 10.555, pesoReal: null }, UNIDAD, KG);
    expect(r).toEqual({ ok: false, codigo: "decimales", mensaje: `El precio de "Harina" admite como máximo 2 decimales.` });
  });

  it("peso real negativo o NaN: rechaza (antes se ignoraba en silencio)", () => {
    expect(guardLineaCompra("Jamón", { cantidad: 8, precioTotal: 100, pesoReal: -1 }, UNIDAD, KG)).toEqual({
      ok: false,
      codigo: "negativo",
      mensaje: `El peso real de "Jamón" tiene que ser mayor que cero.`,
    });
    expect(guardLineaCompra("Jamón", { cantidad: 8, precioTotal: 100, pesoReal: Number.NaN }, UNIDAD, KG).ok).toBe(false);
  });

  it("dos líneas, una con cantidad inválida: el mensaje nombra ESE producto", () => {
    const buena = guardLineaCompra("Harina", { cantidad: 8, precioTotal: 100, pesoReal: null }, UNIDAD, KG);
    const mala = guardLineaCompra("Azúcar", { cantidad: Number.NaN, precioTotal: 100, pesoReal: null }, UNIDAD, KG);
    expect(buena.ok).toBe(true);
    expect(mala.ok).toBe(false);
    expect(!mala.ok && mala.mensaje).toContain("Azúcar");
  });
});

describe("guardNroFacturaCompra", () => {
  it("acepta un formato real y rechaza solo puntuación, en la carga y en la corrección (mismo validador)", () => {
    expect(guardNroFacturaCompra("A-0001-00012345")).toMatchObject({ ok: true });
    expect(guardNroFacturaCompra("---")).toMatchObject({ ok: false });
  });
});
