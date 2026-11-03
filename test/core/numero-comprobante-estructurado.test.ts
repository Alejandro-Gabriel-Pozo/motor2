import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { armarNumeroDeComprobante, leerNumeroDeComprobanteDeCompra, LETRAS_DE_COMPROBANTE } from "../../src/core/datos/numero-comprobante";
import { normalizarNumeroDeComprobante } from "../../src/core/compras/numero-de-comprobante";

/** Número de comprobante estructurado (etapa 1 de Compras, 2026-11-03): letra + PV de 5 dígitos + número de 8. Puro, sin base. */

const armar = (letra: string, puntoDeVenta: string, numero: string) => armarNumeroDeComprobante({ letra, puntoDeVenta, numero });

describe("armarNumeroDeComprobante", () => {
  it.each([
    ["A", "23", "237728", "A-00023-00237728"],
    ["a", "00023", "00237728", "A-00023-00237728"],
    [" x ", " 1 ", " 1 ", "X-00001-00000001"],
    ["C", "99999", "99999999", "C-99999-99999999"],
  ])("acepta %s / %s / %s", (letra, pv, nro, esperado) => {
    expect(armar(letra, pv, nro)).toEqual({ ok: true, valor: esperado });
  });

  it.each([
    ["", "23", "1", "formato", "Elegí la letra"],
    ["D", "23", "1", "formato", "Elegí la letra"],
    ["A", "", "1", "caracteres", "El punto de venta va solo con números"],
    ["A", "2a", "1", "caracteres", "El punto de venta va solo con números"],
    ["A", "123456", "1", "caracteres", "hasta 5 dígitos"],
    ["A", "000023", "1", "caracteres", "hasta 5 dígitos"],
    ["A", "00000", "1", "cero", "El punto de venta no puede ser 0."],
    ["A", "23", "", "caracteres", "El número de la factura va solo con números"],
    ["A", "23", "12-3", "caracteres", "El número de la factura va solo con números"],
    ["A", "23", "123456789", "caracteres", "hasta 8 dígitos"],
    ["A", "23", "0000", "cero", "El número de la factura no puede ser 0."],
  ])("rechaza %s / %s / %s", (letra, pv, nro, codigo, mensaje) => {
    const r = armar(letra, pv, nro);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe(codigo);
      expect(r.mensaje).toContain(mensaje);
    }
  });
});

describe("leerNumeroDeComprobanteDeCompra", () => {
  it.each([
    ["A-23-237728", "A-00023-00237728"],
    ["a 00023 00237728", "A-00023-00237728"],
    ["  B - 1 - 1  ", "B-00001-00000001"],
    ["A-00023-00237728", "A-00023-00237728"],
  ])("lee «%s»", (texto, esperado) => {
    expect(leerNumeroDeComprobanteDeCompra(texto)).toEqual({ ok: true, valor: esperado });
  });

  it.each(["23-237728", "A-23-237728x", "A-23", "AB-23-1", "A/23/1", "A-23-1-4"])("rechaza por formato «%s»", (texto) => {
    const r = leerNumeroDeComprobanteDeCompra(texto);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe("formato");
  });

  it("vacío o solo espacios: falta el número", () => {
    for (const t of ["", "   "]) {
      const r = leerNumeroDeComprobanteDeCompra(t);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.mensaje).toContain("Falta el número de la factura");
    }
  });

  it("delega los rechazos de longitud y ceros", () => {
    const r = leerNumeroDeComprobanteDeCompra("A-000023-1");
    expect(r.ok).toBe(false);
    expect(leerNumeroDeComprobanteDeCompra("A-0-1")).toMatchObject({ ok: false, codigo: "cero" });
  });
});

describe("clave de unicidad del número armado (propiedad)", () => {
  const letra = fc.constantFrom(...LETRAS_DE_COMPROBANTE);
  const pv = fc.integer({ min: 1, max: 99999 });
  const nro = fc.integer({ min: 1, max: 99999999 });
  const clave = (l: string, p: string, n: string) => {
    const r = armar(l, p, n);
    if (!r.ok) throw new Error(r.mensaje);
    return normalizarNumeroDeComprobante(r.valor);
  };

  it("dos escrituras del mismo número dan la misma clave y números distintos dan claves distintas", () => {
    fc.assert(
      fc.property(letra, pv, nro, pv, nro, fc.integer({ min: 0, max: 4 }), fc.integer({ min: 0, max: 7 }), (l, p1, n1, p2, n2, cp, cn) => {
        const cerosPv = "0".repeat(Math.min(cp, 5 - String(p1).length));
        const cerosNro = "0".repeat(Math.min(cn, 8 - String(n1).length));
        expect(clave(l, `${cerosPv}${p1}`, `${cerosNro}${n1}`)).toBe(clave(l, String(p1), String(n1)));
        if (p1 !== p2 || n1 !== n2) expect(clave(l, String(p1), String(n1))).not.toBe(clave(l, String(p2), String(n2)));
      }),
      { numRuns: 500 },
    );
  });
});
