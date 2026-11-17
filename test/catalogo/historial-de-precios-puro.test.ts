import { describe, expect, it } from "vitest";
import { armarHistorialDePrecios, type FilaDeAuditoriaDePrecio } from "../../src/core/catalogo/historial-de-precios";

/**
 * El historial de precios de la ficha (paso 7; dueño, 2026-11-17: «A»), puro: qué filas de auditoría del precio se vuelven una línea «de $X a $Y» y cuáles no. El oráculo está escrito a mano, caso por caso.
 */
const T1 = new Date("2026-11-10T15:00:00Z");
const T2 = new Date("2026-11-12T15:00:00Z");
const fila = (entidad: string, valorAnterior: string | null, valorNuevo: string | null, creadoEn = T1): FilaDeAuditoriaDePrecio => ({ creadoEn, entidad, valorAnterior, valorNuevo });

describe("armarHistorialDePrecios", () => {
  it("un cambio de precio de lista: fecha, de y a", () => {
    expect(armarHistorialDePrecios([fila("Producto", "10000", "12000")])).toEqual([{ creadoEn: T1, alcance: "lista", anterior: 10000, nuevo: 12000 }]);
  });
  it("un cambio del precio de la sucursal", () => {
    expect(armarHistorialDePrecios([fila("PrecioLocalProducto", "12000.00", "13500.50")])).toEqual([{ creadoEn: T1, alcance: "sucursal", anterior: 12000, nuevo: 13500.5 }]);
  });
  it("el primer precio propio de la sucursal (sin anterior) figura como «se fijó»", () => {
    expect(armarHistorialDePrecios([fila("PrecioLocalProducto", null, "13000")])).toEqual([{ creadoEn: T1, alcance: "sucursal", anterior: null, nuevo: 13000 }]);
  });
  it("en el precio de LISTA una fila sin anterior no figura (el alta no deja fila: no se inventa el precio de nacimiento)", () => {
    expect(armarHistorialDePrecios([fila("Producto", null, "10000")])).toEqual([]);
  });
  it("una fila en que el precio no cambió (mismos centavos) no es un cambio", () => {
    expect(armarHistorialDePrecios([fila("Producto", "12000", "12000.00"), fila("PrecioLocalProducto", "5", "5.001")])).toEqual([]);
  });
  it("conserva el orden en que llegan (más reciente primero) y mezcla lista y sucursal", () => {
    const r = armarHistorialDePrecios([fila("PrecioLocalProducto", "12000", "13000", T2), fila("Producto", "10000", "12000", T1)]);
    expect(r.map((l) => [l.alcance, l.nuevo])).toEqual([["sucursal", 13000], ["lista", 12000]]);
  });
  it("lo que no es un precio legible no figura (texto, vacío, signo, notación científica, NaN, con símbolo)", () => {
    for (const raro of ["", " ", "abc", "-5", "1e3", "NaN", "$ 100", "100,50", "Infinity", "12 000"]) {
      expect(armarHistorialDePrecios([fila("Producto", "10", raro)]), `nuevo «${raro}»`).toEqual([]);
      expect(armarHistorialDePrecios([fila("Producto", raro, "10")]), `anterior «${raro}»`).toEqual([]);
    }
    expect(armarHistorialDePrecios([fila("Producto", "10", null)])).toEqual([]);
  });
  it("un anterior ilegible en el precio de la sucursal no se toma por «primer precio»", () => {
    expect(armarHistorialDePrecios([fila("PrecioLocalProducto", "xyz", "100")])).toEqual([]);
  });
  it("otra entidad (precio de una opción, un rol…) no figura", () => {
    expect(armarHistorialDePrecios([fila("PrecioLocalOpcion", "1", "2"), fila("PermisoRol", "1", "2"), fila("", "1", "2")])).toEqual([]);
  });
  it("sin filas, sin líneas", () => {
    expect(armarHistorialDePrecios([])).toEqual([]);
  });
});
