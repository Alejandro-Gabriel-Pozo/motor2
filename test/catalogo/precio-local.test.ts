import { describe, expect, it } from "vitest";
import { filtrarPreciosLocalesVigentes } from "../../src/core/catalogo/public";

/** La regla única del Precio Local: rige solo con la capacidad `precio_local` de la sucursal Y la fila habilitada. */
describe("filtrarPreciosLocalesVigentes", () => {
  const filas = [
    { productoId: "p-habilitado", precio: 800, habilitado: true },
    { productoId: "p-deshabilitado", precio: 700, habilitado: false },
  ];

  it("capacidad encendida + fila habilitada → el precio local rige", () => {
    expect(filtrarPreciosLocalesVigentes(filas, true).get("p-habilitado")).toEqual({ precio: 800, habilitado: true });
  });

  it("capacidad apagada → no rige ninguno, aunque exista una fila habilitada (se cobra el central)", () => {
    expect(filtrarPreciosLocalesVigentes(filas, false).size).toBe(0);
  });

  it("capacidad encendida + fila deshabilitada → no rige (se cobra el central)", () => {
    expect(filtrarPreciosLocalesVigentes(filas, true).has("p-deshabilitado")).toBe(false);
  });

  it("capacidad encendida + sin fila → no rige (se cobra el central)", () => {
    expect(filtrarPreciosLocalesVigentes(filas, true).has("p-sin-fila")).toBe(false);
  });

  it("no toca las filas recibidas: reactivar la capacidad vuelve a aplicarlas", () => {
    expect(filtrarPreciosLocalesVigentes(filas, false).size).toBe(0);
    expect(filtrarPreciosLocalesVigentes(filas, true).size).toBe(1);
  });
});
