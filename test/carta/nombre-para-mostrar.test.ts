import { describe, expect, it } from "vitest";
import { nombreParaMostrar } from "../../src/core/carta/public";

/** El nombre para mostrar (pedido del dueño, 2026-11-05): una base con el nombre oculto se lee por los rótulos de su medida, con el nombre interno entre paréntesis; el resto, como siempre. */
const medida = { prefijoEnCarta: null, opciones: [{ nombre: "Bife a  criolla", esNinguna: false }, { nombre: "Bife con chimichurri", esNinguna: false }] };
describe("nombreParaMostrar", () => {
  it("una base con el nombre oculto: los rótulos de la medida unidos con « · » y el nombre interno entre paréntesis", () => {
    expect(nombreParaMostrar({ nombre: "BIFE-", esBase: true, medida })).toBe("Bife a  criolla · Bife con chimichurri (BIFE-)");
  });
  it("usa el prefijo de lectura de la carta (la misma lectura que la carta) y no cuenta la opción «ninguna»", () => {
    const r = nombreParaMostrar({ nombre: "PIZZA-", esBase: true, medida: { prefijoEnCarta: "Pizza", opciones: [{ nombre: "Muzzarella", esNinguna: false }, { nombre: "Ninguna", esNinguna: true }, { nombre: "Fugazzeta", esNinguna: false }] } });
    expect(r).toBe("Pizza muzzarella · Pizza fugazzeta (PIZZA-)");
  });
  it("con el nombre arriba, sin medida o sin opciones: el nombre en la carta o el interno, como hoy", () => {
    expect(nombreParaMostrar({ nombre: "BIFE-", esBase: true, mostrarNombreArriba: true, medida })).toBe("BIFE-");
    expect(nombreParaMostrar({ nombre: "BIFE-", nombreEnCarta: "Bife del día", esBase: true, mostrarNombreArriba: true, medida })).toBe("Bife del día");
    expect(nombreParaMostrar({ nombre: "BIFE-", esBase: true, medida: null })).toBe("BIFE-");
    expect(nombreParaMostrar({ nombre: "BIFE-", esBase: true, medida: { prefijoEnCarta: null, opciones: [] } })).toBe("BIFE-");
  });
  it("un producto que no es base: el nombre en la carta o el del producto", () => {
    expect(nombreParaMostrar({ nombre: "Agua 500 cc", esBase: false, medida })).toBe("Agua 500 cc");
    expect(nombreParaMostrar({ nombre: "Agua 500 cc", nombreEnCarta: "Agua mineral", esBase: false, medida: null })).toBe("Agua mineral");
    expect(nombreParaMostrar({ nombre: "Agua 500 cc", nombreEnCarta: "  ", esBase: false, medida: null })).toBe("Agua 500 cc");
  });
});
