import { describe, expect, it } from "vitest";
import { DECIMALES_IMPORTE, IMPORTE_MAXIMO, validarImporte } from "@/core/datos/importe";

// Sin base de datos: validarImporte es pura. Es la MISMA función que usan CampoNumero (tipo="importe") y las Server Actions.
const precio = { etiqueta: "El precio" };

describe("validarImporte", () => {
  it("constantes: 2 decimales y tope de Decimal(14,2)", () => {
    expect(DECIMALES_IMPORTE).toBe(2);
    expect(IMPORTE_MAXIMO).toBe(1e12);
  });

  it("vacío no obligatorio → null (sin precio)", () => {
    for (const v of [undefined, null, "", "   "]) expect(validarImporte(v, precio)).toEqual({ ok: true, valor: null });
  });

  it("vacío obligatorio → 'Falta el precio.'", () => {
    for (const v of [undefined, null, "", "   "]) {
      expect(validarImporte(v, { ...precio, obligatorio: true })).toEqual({ ok: false, codigo: "vacio", mensaje: "Falta el precio." });
    }
  });

  it("0: permitido por defecto, rechazado con permitirCero: false", () => {
    expect(validarImporte(0, precio)).toEqual({ ok: true, valor: 0 });
    expect(validarImporte(0, { ...precio, permitirCero: false })).toMatchObject({ ok: false, codigo: "cero" });
  });

  it("negativo: rechazado con el mensaje exacto de hoy, salvo permitirNegativo", () => {
    expect(validarImporte(-1, precio)).toEqual({ ok: false, codigo: "negativo", mensaje: "El precio no puede ser negativo." });
    expect(validarImporte(-0.01, precio)).toMatchObject({ ok: false, codigo: "negativo" });
    expect(validarImporte(-1, { ...precio, permitirNegativo: true })).toEqual({ ok: true, valor: -1 });
  });

  it.each([0.07, 10.01, 19.17, 23.33, 1234.56, 999_999_999_999.99])("acepta %d (a lo sumo 2 decimales, sin ruido de punto flotante)", (n) => {
    expect(validarImporte(n, precio)).toEqual({ ok: true, valor: n });
  });

  it.each([1.005, 12.345, 10.555, 0.001])("rechaza %d: más de 2 decimales (no se redondea en silencio)", (n) => {
    const r = validarImporte(n, precio);
    expect(r).toMatchObject({ ok: false, codigo: "decimales" });
    if (!r.ok) expect(r.mensaje).toBe("El precio admite como máximo 2 decimales.");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, true, false, {}, [], [5], Symbol("x"), BigInt(10)])(
    "rechaza %s como formato inválido con el mensaje exacto de hoy",
    (v) => {
      expect(validarImporte(v, precio)).toEqual({ ok: false, codigo: "formato", mensaje: "El precio no es un número válido." });
    }
  );

  it("tope 1e12 (Decimal(14,2))", () => {
    expect(validarImporte(1e12, precio)).toMatchObject({ ok: false, codigo: "rango" });
    expect(validarImporte(-1e12, { ...precio, permitirNegativo: true })).toMatchObject({ ok: false, codigo: "rango" });
    expect(validarImporte(1e12 - 0.01, precio)).toEqual({ ok: true, valor: 1e12 - 0.01 });
  });

  it("texto tecleado en es-AR", () => {
    expect(validarImporte("1.234,56", precio)).toEqual({ ok: true, valor: 1234.56 });
    expect(validarImporte("1.000.000", precio)).toEqual({ ok: true, valor: 1_000_000 });
    expect(validarImporte("...,.,.,...", precio)).toEqual({ ok: false, codigo: "formato", mensaje: "El precio no es un número válido." });
    expect(validarImporte("abc", precio)).toMatchObject({ ok: false, codigo: "formato" });
    expect(validarImporte("12,345", precio)).toMatchObject({ ok: false, codigo: "decimales" });
    expect(validarImporte("-5", precio)).toMatchObject({ ok: false, codigo: "negativo" });
  });

  it("la etiqueta arma el mensaje", () => {
    expect(validarImporte(-5, { etiqueta: 'El precio de "Harina"' })).toMatchObject({ mensaje: 'El precio de "Harina" no puede ser negativo.' });
    expect(validarImporte(undefined, { etiqueta: "El precio total", obligatorio: true })).toMatchObject({ mensaje: "Falta el precio total." });
  });
});
