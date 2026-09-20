import { describe, expect, it } from "vitest";
import { validarLargoTexto, LARGO_MAXIMO_NRO_FACTURA } from "@/core/texto";

// Sin base de datos: validarLargoTexto es pura.
describe("validarLargoTexto — número de factura del proveedor", () => {
  it("acepta hasta el máximo de caracteres", () => {
    const nroFactura = "A".repeat(LARGO_MAXIMO_NRO_FACTURA);
    expect(validarLargoTexto(nroFactura, "El número de factura", LARGO_MAXIMO_NRO_FACTURA)).toBeNull();
  });

  it("rechaza un caracter más que el máximo", () => {
    const nroFactura = "A".repeat(LARGO_MAXIMO_NRO_FACTURA + 1);
    expect(validarLargoTexto(nroFactura, "El número de factura", LARGO_MAXIMO_NRO_FACTURA)).toBe(
      `El número de factura no puede superar los ${LARGO_MAXIMO_NRO_FACTURA} caracteres.`,
    );
  });

  it("vacío o solo espacios no es asunto de este validador", () => {
    expect(validarLargoTexto("", "El número de factura", LARGO_MAXIMO_NRO_FACTURA)).toBeNull();
    expect(validarLargoTexto("   ", "El número de factura", LARGO_MAXIMO_NRO_FACTURA)).toBeNull();
  });

  // A propósito: el número de factura es texto libre del proveedor, sin charset propio —
  // a diferencia de validarTextoCatalogo. Este test fija esa decisión de diseño por escrito.
  it("no valida charset: caracteres típicos de una factura real pasan sin problema", () => {
    expect(validarLargoTexto("A-0001-00001234", "El número de factura", LARGO_MAXIMO_NRO_FACTURA)).toBeNull();
    expect(validarLargoTexto("#12/345*", "El número de factura", LARGO_MAXIMO_NRO_FACTURA)).toBeNull();
    expect(validarLargoTexto("-0001", "El número de factura", LARGO_MAXIMO_NRO_FACTURA)).toBeNull();
  });
});
