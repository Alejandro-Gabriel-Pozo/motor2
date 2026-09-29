import { describe, expect, it } from "vitest";
import { formatearPrecioCarta } from "@/core/carta/precio-carta";

describe("formatearPrecioCarta", () => {
  it("formatea con $ a la izquierda y separador de miles es-AR", () => {
    expect(formatearPrecioCarta(12345)).toBe("$12.345");
  });

  it("sin decimales si no hace falta", () => {
    expect(formatearPrecioCarta(100)).toBe("$100");
  });

  it("hasta 2 decimales cuando el precio los tiene", () => {
    expect(formatearPrecioCarta(1234.5)).toBe("$1.234,5");
  });

  it("cero se formatea igual que cualquier otro número", () => {
    expect(formatearPrecioCarta(0)).toBe("$0");
  });
});
