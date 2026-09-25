import { describe, expect, it } from "vitest";
import { CANTIDAD_MAXIMA, validarCantidad } from "@/core/datos/cantidad";

// Sin base de datos: validarCantidad es pura. Los decimales vienen de Unidad.decimales (0 a 6).
const un = { nombre: "un", decimales: 0 };
const kg = { nombre: "kg", decimales: 2 };
const lt = { nombre: "lt", decimales: 4 };
const cantidad = { etiqueta: "La cantidad" };

describe("validarCantidad", () => {
  it("tope de Decimal(14,4)", () => {
    expect(CANTIDAD_MAXIMA).toBe(1e10);
    expect(validarCantidad(1e10, kg, cantidad)).toMatchObject({ ok: false, codigo: "rango" });
    expect(validarCantidad(1e10 - 1, un, cantidad)).toEqual({ ok: true, valor: 1e10 - 1 });
  });

  it("unidad de 0 decimales: rechaza 2,5 (antes se redondeaba a 3) y acepta 3", () => {
    const r = validarCantidad(2.5, un, cantidad);
    expect(r).toMatchObject({ ok: false, codigo: "decimales" });
    if (!r.ok) expect(r.mensaje).toBe('La cantidad tiene que ser un número entero (la unidad "un" no admite decimales).');
    expect(validarCantidad(3, un, cantidad)).toEqual({ ok: true, valor: 3 });
  });

  it("unidad de 2 decimales: acepta 1,25 y rechaza 1,255", () => {
    expect(validarCantidad(1.25, kg, cantidad)).toEqual({ ok: true, valor: 1.25 });
    const r = validarCantidad(1.255, kg, cantidad);
    expect(r).toMatchObject({ ok: false, codigo: "decimales" });
    if (!r.ok) expect(r.mensaje).toBe('La cantidad admite como máximo 2 decimales (unidad "kg").');
  });

  it("sin nombre de unidad, el mensaje no la menciona", () => {
    expect(validarCantidad(2.5, { nombre: "", decimales: 0 }, cantidad)).toMatchObject({ mensaje: "La cantidad tiene que ser un número entero." });
    expect(validarCantidad(1.255, { nombre: "", decimales: 2 }, cantidad)).toMatchObject({ mensaje: "La cantidad admite como máximo 2 decimales." });
  });

  it("unidad de 4 decimales: acepta 1,2345", () => {
    expect(validarCantidad(1.2345, lt, cantidad)).toEqual({ ok: true, valor: 1.2345 });
    expect(validarCantidad(1.23456, lt, cantidad)).toMatchObject({ ok: false, codigo: "decimales" });
  });

  it("vacío: null si no es obligatoria, 'Falta …' si lo es", () => {
    expect(validarCantidad(undefined, kg, cantidad)).toEqual({ ok: true, valor: null });
    expect(validarCantidad(null, kg, cantidad)).toEqual({ ok: true, valor: null });
    expect(validarCantidad("", kg, { ...cantidad, obligatorio: true })).toEqual({ ok: false, codigo: "vacio", mensaje: "Falta la cantidad." });
  });

  it("0: rechazado por defecto, aceptado con permitirCero", () => {
    expect(validarCantidad(0, kg, cantidad)).toEqual({ ok: false, codigo: "cero", mensaje: "La cantidad tiene que ser mayor que cero." });
    expect(validarCantidad(0, kg, { ...cantidad, permitirCero: true })).toEqual({ ok: true, valor: 0 });
  });

  it("negativo: rechazado por defecto, aceptado con permitirNegativo", () => {
    expect(validarCantidad(-1, kg, cantidad)).toEqual({ ok: false, codigo: "negativo", mensaje: "La cantidad tiene que ser mayor que cero." });
    expect(validarCantidad(-1, kg, { ...cantidad, permitirCero: true })).toEqual({
      ok: false,
      codigo: "negativo",
      mensaje: "La cantidad no puede ser menor que cero.",
    });
    expect(validarCantidad(-1.25, kg, { ...cantidad, permitirNegativo: true })).toEqual({ ok: true, valor: -1.25 });
    expect(validarCantidad(-1.255, kg, { ...cantidad, permitirNegativo: true })).toMatchObject({ ok: false, codigo: "decimales" });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, true, {}, "abc", "1,2,3"])("rechaza %s como formato inválido", (v) => {
    expect(validarCantidad(v, kg, { etiqueta: 'La cantidad de "Harina"' })).toEqual({
      ok: false,
      codigo: "formato",
      mensaje: 'La cantidad de "Harina" no es un número válido.',
    });
  });

  it("texto tecleado en es-AR", () => {
    expect(validarCantidad("1,25", kg, cantidad)).toEqual({ ok: true, valor: 1.25 });
    expect(validarCantidad("1.000", un, cantidad)).toEqual({ ok: true, valor: 1 }); // un solo separador = decimal: 1,000
    expect(validarCantidad("1.5", un, cantidad)).toMatchObject({ ok: false, codigo: "decimales" });
    expect(validarCantidad("1.000.000", un, cantidad)).toEqual({ ok: true, valor: 1_000_000 });
  });
});
