import { describe, expect, it } from "vitest";
import { DECIMALES_PORCENTAJE_DESCUENTO, PORCENTAJE_DESCUENTO_MAXIMO, validarPorcentajeDescuento } from "@/core/datos/porcentaje-descuento";

// Sin base de datos: validarPorcentajeDescuento es pura. La usan el alta/edición de Cliente (server action y formulario).
describe("validarPorcentajeDescuento", () => {
  it("constantes: 2 decimales, tope 100 (Decimal(5,2))", () => {
    expect(DECIMALES_PORCENTAJE_DESCUENTO).toBe(2);
    expect(PORCENTAJE_DESCUENTO_MAXIMO).toBe(100);
  });

  it("vacío, obligatorio por defecto → 'Falta el % de descuento.'", () => {
    for (const v of [undefined, null, "", "   "]) {
      expect(validarPorcentajeDescuento(v)).toEqual({ ok: false, codigo: "vacio", mensaje: "Falta el % de descuento." });
    }
  });

  it("vacío, no obligatorio → null", () => {
    for (const v of [undefined, null, "", "   "]) {
      expect(validarPorcentajeDescuento(v, { obligatorio: false })).toEqual({ ok: true, valor: null });
    }
  });

  it("0 % es válido (cliente sin descuento hoy, pero que puede tenerlo mañana)", () => {
    expect(validarPorcentajeDescuento(0)).toEqual({ ok: true, valor: 0 });
  });

  it("acepta valores típicos, hasta 2 decimales", () => {
    for (const n of [10, 15.5, 33.33, 50, 99, 99.99]) expect(validarPorcentajeDescuento(n)).toEqual({ ok: true, valor: n });
  });

  it("negativo: rechazado", () => {
    expect(validarPorcentajeDescuento(-1)).toEqual({ ok: false, codigo: "negativo", mensaje: "El % de descuento no puede ser negativo." });
    expect(validarPorcentajeDescuento(-0.01)).toMatchObject({ ok: false, codigo: "negativo" });
  });

  it("tope: 100 y cualquier valor mayor se rechaza (D4 — tope < 100%, sin excepción)", () => {
    expect(validarPorcentajeDescuento(100)).toEqual({ ok: false, codigo: "rango", mensaje: "El % de descuento tiene que ser menor que 100 %." });
    expect(validarPorcentajeDescuento(100.01)).toMatchObject({ ok: false, codigo: "rango" });
    expect(validarPorcentajeDescuento(150)).toMatchObject({ ok: false, codigo: "rango" });
  });

  it("justo debajo del tope es válido", () => {
    expect(validarPorcentajeDescuento(99.99)).toEqual({ ok: true, valor: 99.99 });
  });

  it.each([1.005, 12.345, 10.555])("rechaza %d: más de 2 decimales", (n) => {
    expect(validarPorcentajeDescuento(n)).toMatchObject({ ok: false, codigo: "decimales" });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, true, false, {}, [], [5], Symbol("x"), BigInt(10)])(
    "rechaza %s como formato inválido",
    (v) => {
      expect(validarPorcentajeDescuento(v)).toEqual({ ok: false, codigo: "formato", mensaje: "El % de descuento no es un número válido." });
    }
  );

  it("texto tecleado en es-AR", () => {
    expect(validarPorcentajeDescuento("15,5")).toEqual({ ok: true, valor: 15.5 });
    expect(validarPorcentajeDescuento("abc")).toMatchObject({ ok: false, codigo: "formato" });
    expect(validarPorcentajeDescuento("-5")).toMatchObject({ ok: false, codigo: "negativo" });
  });
});
