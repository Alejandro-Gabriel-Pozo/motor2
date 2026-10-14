import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { aCentavos, deCentavos, precioAjustado, validarAjusteDePrecio, REDONDEO_POR_DEFECTO, type AjusteDePrecio } from "../../src/core/carta/ajuste-de-precios";

/**
 * CARTA-MANT F4 (fila O.484 de docs/pureza-integracion.md): el cálculo del precio nuevo al ajustar una sección, en decimal EXACTO (centavos enteros, nunca coma flotante), con el redondeo
 * configurable del cálculo puro (la pantalla va SIN redondeo: decisión del dueño, 2026-10-14) y el piso de $0,01.
 */
const ajuste = (cambios: Partial<AjusteDePrecio>): AjusteDePrecio => ({ direccion: "subir", modo: "porcentaje", valor: "10.00", redondeo: 0, ...cambios });

describe("aCentavos / deCentavos", () => {
  it("texto decimal ↔ centavos, con coma o punto y hasta dos decimales; lo demás no", () => {
    expect(aCentavos("14900")).toBe(BigInt(1490000));
    expect(aCentavos("14900,5")).toBe(BigInt(1490050));
    expect(aCentavos(" 0.07 ")).toBe(BigInt(7));
    for (const malo of ["", "-1", "1.234", "abc", "1e3", "14.900,50", "1234567890123"]) expect(aCentavos(malo), malo).toBeNull();
    expect(deCentavos(BigInt(1490050))).toBe("14900.50");
    expect(deCentavos(BigInt(7))).toBe("0.07");
  });
});

describe("precioAjustado", () => {
  it("por defecto SIN redondeo (decisión del dueño): al centavo", () => {
    expect(REDONDEO_POR_DEFECTO).toBe(0);
    expect(precioAjustado("14900.00", ajuste({ valor: "12.5" }))).toBe("16762.50");
    expect(precioAjustado("0.10", ajuste({ valor: "33.33" }))).toBe("0.13"); // 0,0333 → 0,03 (al centavo, mitades hacia arriba)
    expect(precioAjustado("0.15", ajuste({ valor: "10" }))).toBe("0.17"); // 0,015 → 0,02
  });

  it("sin ruido de coma flotante: 0,1 + 0,2 da 0,30 y un 7 % de $1.000,10 da $1.070,11", () => {
    expect(precioAjustado("0.10", ajuste({ modo: "monto", valor: "0.20" }))).toBe("0.30");
    expect(precioAjustado("1000.10", ajuste({ valor: "7" }))).toBe("1070.11");
  });

  it("redondeo al múltiplo más cercano ($10, $50, $100), mitades hacia arriba; y su caso raro escrito: subir poco puede bajar un poco", () => {
    expect(precioAjustado("14900.00", ajuste({ valor: "10", redondeo: 10 }))).toBe("16390.00");
    expect(precioAjustado("14904.99", ajuste({ modo: "monto", valor: "0.01", redondeo: 10 }))).toBe("14910.00"); // 14.905 → mitad: hacia arriba
    expect(precioAjustado("14900.00", ajuste({ valor: "10", redondeo: 50 }))).toBe("16400.00");
    expect(precioAjustado("14900.00", ajuste({ valor: "10", redondeo: 100 }))).toBe("16400.00");
    expect(precioAjustado("14903.00", ajuste({ valor: "0.01", redondeo: 10 }))).toBe("14900.00");
  });

  it("bajar: en % y en $; nunca queda en $0 (piso $0,01, o el múltiplo si hay redondeo)", () => {
    expect(precioAjustado("6200.00", ajuste({ direccion: "bajar", valor: "15" }))).toBe("5270.00");
    expect(precioAjustado("6200.00", ajuste({ direccion: "bajar", modo: "monto", valor: "7000" }))).toBe("0.01");
    expect(precioAjustado("6200.00", ajuste({ direccion: "bajar", modo: "monto", valor: "7000", redondeo: 100 }))).toBe("100.00");
  });

  it("«Cambiar precio» de uno: el precio nuevo tal cual, sin redondeo", () => {
    expect(precioAjustado("6200.00", ajuste({ modo: "precio", valor: "6345.5", redondeo: 100 }))).toBe("6345.50");
  });

  it("propiedad: con redondeo R, el precio es múltiplo de R, ≥ R y está a lo sumo R/2 del exacto (salvo el piso); sin redondeo, al centavo y ≥ $0,01", () => {
    const precio = fc.integer({ min: 1, max: 99_999_999 }).map((c) => deCentavos(BigInt(c)));
    const valor = fc.integer({ min: 1, max: 9_999 }).map((c) => deCentavos(BigInt(c)));
    fc.assert(
      fc.property(precio, valor, fc.constantFrom<"subir" | "bajar">("subir", "bajar"), fc.constantFrom<"porcentaje" | "monto">("porcentaje", "monto"), fc.constantFrom(0, 10, 50, 100 as const), (p, v, direccion, modo, redondeo) => {
        const a: AjusteDePrecio = { direccion, modo, valor: v, redondeo: redondeo as AjusteDePrecio["redondeo"] };
        const nuevo = aCentavos(precioAjustado(p, a))!;
        const sinRedondeo = aCentavos(precioAjustado(p, { ...a, redondeo: 0 }))!;
        expect(nuevo >= BigInt(1)).toBe(true);
        if (redondeo === 0) {
          // Subir nunca baja y bajar nunca sube (sin redondeo).
          if (direccion === "subir") expect(nuevo >= aCentavos(p)!).toBe(true);
          else expect(nuevo <= aCentavos(p)!).toBe(true);
          return;
        }
        const r = BigInt(redondeo * 100);
        expect(nuevo % r).toBe(BigInt(0));
        expect(nuevo >= r).toBe(true);
        const diferencia = nuevo > sinRedondeo ? nuevo - sinRedondeo : sinRedondeo - nuevo;
        if (sinRedondeo >= r) expect(diferencia * BigInt(2) <= r).toBe(true);
      })
    );
  });
});

describe("validarAjusteDePrecio", () => {
  it("dirección, modo, redondeo de la lista y un valor > 0 con hasta dos decimales; topes del porcentaje", () => {
    expect(validarAjusteDePrecio({ direccion: "subir", modo: "porcentaje", valor: "12,5", redondeo: 10 })).toEqual({ ok: true, valor: { direccion: "subir", modo: "porcentaje", valor: "12.50", redondeo: 10 } });
    expect(validarAjusteDePrecio({ direccion: "arriba", modo: "porcentaje", valor: "1", redondeo: 0 }).ok).toBe(false);
    expect(validarAjusteDePrecio({ direccion: "subir", modo: "porcentaje", valor: "1", redondeo: 20 }).ok).toBe(false);
    expect(validarAjusteDePrecio({ direccion: "subir", modo: "monto", valor: "0", redondeo: 0 }).ok).toBe(false);
    expect(validarAjusteDePrecio({ direccion: "subir", modo: "monto", valor: 10, redondeo: 0 }).ok).toBe(false);
    expect(validarAjusteDePrecio({ direccion: "subir", modo: "porcentaje", valor: "501", redondeo: 0 }).ok).toBe(false);
    expect(validarAjusteDePrecio({ direccion: "bajar", modo: "porcentaje", valor: "100", redondeo: 0 }).ok).toBe(false);
    expect(validarAjusteDePrecio({ direccion: "bajar", modo: "porcentaje", valor: "99.99", redondeo: 0 }).ok).toBe(true);
  });
});
