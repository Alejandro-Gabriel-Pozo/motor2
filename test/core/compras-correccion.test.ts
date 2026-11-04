import { describe, expect, it } from "vitest";
import {
  LARGO_MAXIMO_DETALLE_COMPRA,
  cabeceraCoincide,
  descripcionAuditoriaCorreccion,
  diferenciasDeCabecera,
  mensajeCompraCorregida,
  normalizarCorreccion,
  validarCorreccion,
  type CabeceraCompra,
} from "../../src/core/compras/correccion";

/** Módulo puro: sin base de datos, sin mocks. */
const cabecera = (sobre: Partial<CabeceraCompra> = {}): CabeceraCompra => ({ proveedorId: "prov1", nroFactura: "A-0001", detalleLibre: "compra de la semana", ...sobre });

describe("normalizarCorreccion", () => {
  it("recorta espacios y convierte el vacío en null (como la carga de una compra)", () => {
    expect(normalizarCorreccion({ proveedorId: "  prov1 ", nroFactura: "  A-1  ", detalleLibre: "  nota  " })).toEqual({ proveedorId: "prov1", nroFactura: "A-1", detalleLibre: "nota" });
    expect(normalizarCorreccion({ proveedorId: "", nroFactura: "   ", detalleLibre: undefined })).toEqual({ proveedorId: null, nroFactura: null, detalleLibre: null });
    expect(normalizarCorreccion({ proveedorId: null, nroFactura: null, detalleLibre: null })).toEqual({ proveedorId: null, nroFactura: null, detalleLibre: null });
  });
});

describe("diferenciasDeCabecera", () => {
  it("sin cambios no devuelve nada", () => {
    expect(diferenciasDeCabecera(cabecera(), cabecera())).toEqual([]);
  });

  it("devuelve solo los campos que cambian, con el valor anterior y el nuevo, en orden fijo", () => {
    const r = diferenciasDeCabecera(cabecera({ proveedorId: null, nroFactura: "A-0001" }), cabecera({ proveedorId: "prov2", nroFactura: "A-0002" }));
    expect(r).toEqual([
      { campo: "proveedorId", anterior: null, nuevo: "prov2" },
      { campo: "nroFactura", anterior: "A-0001", nuevo: "A-0002" },
    ]);
  });

  it("borrar un dato (pasarlo a null) también es un cambio", () => {
    expect(diferenciasDeCabecera(cabecera(), cabecera({ detalleLibre: null }))).toEqual([{ campo: "detalleLibre", anterior: "compra de la semana", nuevo: null }]);
  });
});

describe("validarCorreccion — solo valida lo que cambia", () => {
  it("acepta un detalle dentro del largo", () => {
    expect(validarCorreccion([{ campo: "detalleLibre", anterior: null, nuevo: "x".repeat(LARGO_MAXIMO_DETALLE_COMPRA) }])).toBeNull();
  });

  it("rechaza un detalle de más de 200 caracteres", () => {
    expect(validarCorreccion([{ campo: "detalleLibre", anterior: null, nuevo: "x".repeat(LARGO_MAXIMO_DETALLE_COMPRA + 1) }])).toContain("200 caracteres");
  });

  it("un detalle viejo, más largo que el límite de hoy y que NO se toca, no traba la corrección de otro campo", () => {
    // El detalle largo no está entre los cambios: solo se corrige el proveedor.
    expect(validarCorreccion([{ campo: "proveedorId", anterior: null, nuevo: "prov1" }])).toBeNull();
  });

  it("un N.º de factura viejo inválido que NO se toca no traba la corrección de otro campo", () => {
    expect(validarCorreccion([{ campo: "detalleLibre", anterior: null, nuevo: "nota" }])).toBeNull();
  });
});

describe("cabeceraCoincide (guarda optimista)", () => {
  it("coincide solo si los tres campos son iguales", () => {
    expect(cabeceraCoincide(cabecera(), cabecera())).toBe(true);
    expect(cabeceraCoincide(cabecera(), cabecera({ proveedorId: "otro" }))).toBe(false);
    expect(cabeceraCoincide(cabecera(), cabecera({ nroFactura: "A-9" }))).toBe(false);
    expect(cabeceraCoincide(cabecera(), cabecera({ detalleLibre: null }))).toBe(false);
  });

  it("null y null coinciden (una compra sin proveedor sigue igual)", () => {
    expect(cabeceraCoincide(cabecera({ proveedorId: null }), cabecera({ proveedorId: null }))).toBe(true);
  });
});

/** Armadores de textos (Task #41, Fase M): EXACTAMENTE los que armaba en línea la Server Action `corregirCompra`. */
describe("mensajeCompraCorregida / descripcionAuditoriaCorreccion", () => {
  it("mensaje de éxito con las etiquetas de los campos que cambiaron, en orden", () => {
    expect(mensajeCompraCorregida([{ campo: "proveedorId", anterior: null, nuevo: "p" }])).toBe("Compra corregida: proveedor.");
    expect(
      mensajeCompraCorregida([
        { campo: "nroFactura", anterior: "A", nuevo: "B" },
        { campo: "detalleLibre", anterior: null, nuevo: "x" },
      ])
    ).toBe("Compra corregida: N.º de factura, detalle.");
  });

  it("descripción de auditoría, con y sin el N.º de factura anterior", () => {
    const fecha = new Date("2026-08-10T12:00:00Z");
    expect(descripcionAuditoriaCorreccion(fecha, "A-0001", "proveedorId")).toBe("Compra del 2026-08-10 (factura A-0001): proveedor");
    expect(descripcionAuditoriaCorreccion(fecha, null, "nroFactura")).toBe("Compra del 2026-08-10: N.º de factura");
    expect(descripcionAuditoriaCorreccion(fecha, null, "detalleLibre")).toBe("Compra del 2026-08-10: detalle");
  });

  it("P1 paso 7: el día es el argentino — una compra de las 22:30 argentinas del 10/8 (01:30Z del 11/8) es del 10/8", () => {
    expect(descripcionAuditoriaCorreccion(new Date("2026-08-11T01:30:00Z"), "A-0001", "proveedorId")).toBe("Compra del 2026-08-10 (factura A-0001): proveedor");
    expect(descripcionAuditoriaCorreccion(new Date("2027-01-01T02:59:59Z"), null, "nroFactura")).toBe("Compra del 2026-12-31: N.º de factura");
  });
});
