import { describe, expect, it } from "vitest";
import {
  resolverDisponibilidad,
  resolverDisponibilidadPorSucursal,
  estaDisponibleEnAlguna,
  contarSucursalesDisponibles,
  productosUniversales,
} from "@/core/catalogo/disponibilidad-producto";

describe("resolverDisponibilidad", () => {
  it("sin fila, NO está disponible", () => {
    expect(resolverDisponibilidad(null)).toBe(false);
    expect(resolverDisponibilidad(undefined)).toBe(false);
  });

  it("con fila disponible: true, está disponible", () => {
    expect(resolverDisponibilidad({ disponible: true })).toBe(true);
  });

  it("con fila disponible: false, NO está disponible — mismo resultado que sin fila", () => {
    expect(resolverDisponibilidad({ disponible: false })).toBe(false);
  });
});

describe("resolverDisponibilidadPorSucursal", () => {
  it("una sucursal sin fila propia no cuenta como disponible", () => {
    const filas = [{ sucursalId: "A", disponible: true }];
    const resultado = resolverDisponibilidadPorSucursal(filas, ["A", "B"]);
    expect(resultado.get("A")).toBe(true);
    expect(resultado.get("B")).toBe(false);
  });

  it("una fila con disponible: false da false, igual que si no existiera", () => {
    const filas = [{ sucursalId: "A", disponible: false }];
    const resultado = resolverDisponibilidadPorSucursal(filas, ["A"]);
    expect(resultado.get("A")).toBe(false);
  });
});

describe("estaDisponibleEnAlguna", () => {
  it("un producto sin ninguna fila no está disponible en ninguna", () => {
    expect(estaDisponibleEnAlguna([])).toBe(false);
  });

  it("todas las filas en false: no disponible en ninguna (equivale al activo:false global de antes)", () => {
    expect(estaDisponibleEnAlguna([{ disponible: false }, { disponible: false }])).toBe(false);
  });

  it("al menos una fila en true: disponible en alguna", () => {
    expect(estaDisponibleEnAlguna([{ disponible: false }, { disponible: true }])).toBe(true);
  });
});

describe("contarSucursalesDisponibles", () => {
  it("cuenta solo las filas con disponible: true, sobre el total de sucursales dado", () => {
    const filas = [{ disponible: true }, { disponible: false }, { disponible: true }];
    expect(contarSucursalesDisponibles(filas, 4)).toEqual({ disponibles: 2, total: 4 });
  });
});

describe("productosUniversales", () => {
  it("un producto disponible en las 3 sucursales activas es universal", () => {
    const mapa = new Map([
      [
        "prod-universal",
        [
          { sucursalId: "A", disponible: true },
          { sucursalId: "B", disponible: true },
          { sucursalId: "C", disponible: true },
        ],
      ],
    ]);
    expect(productosUniversales(mapa, ["A", "B", "C"])).toEqual(["prod-universal"]);
  });

  it("un producto disponible en 2 de 3 (mayoría, no todas) NO es universal", () => {
    const mapa = new Map([
      [
        "prod-parcial",
        [
          { sucursalId: "A", disponible: true },
          { sucursalId: "B", disponible: true },
          { sucursalId: "C", disponible: false },
        ],
      ],
    ]);
    expect(productosUniversales(mapa, ["A", "B", "C"])).toEqual([]);
  });

  it("una sucursal sin fila propia rompe la universalidad (cuenta como no disponible)", () => {
    const mapa = new Map([
      [
        "prod-sin-fila-en-C",
        [
          { sucursalId: "A", disponible: true },
          { sucursalId: "B", disponible: true },
          // sin fila para "C"
        ],
      ],
    ]);
    expect(productosUniversales(mapa, ["A", "B", "C"])).toEqual([]);
  });

  it("sin ninguna sucursal activa (la primera sucursal del sistema): siempre da vacío, nunca 'todos' por vacuidad", () => {
    const mapa = new Map([["prod-cualquiera", [{ sucursalId: "A", disponible: true }]]]);
    expect(productosUniversales(mapa, [])).toEqual([]);
  });

  it("con varios productos, devuelve solo los universales, en cualquier orden de entrada", () => {
    const mapa = new Map([
      [
        "universal",
        [
          { sucursalId: "A", disponible: true },
          { sucursalId: "B", disponible: true },
        ],
      ],
      [
        "parcial",
        [
          { sucursalId: "A", disponible: true },
          { sucursalId: "B", disponible: false },
        ],
      ],
      [
        "ninguna",
        [
          { sucursalId: "A", disponible: false },
          { sucursalId: "B", disponible: false },
        ],
      ],
    ]);
    expect(productosUniversales(mapa, ["A", "B"])).toEqual(["universal"]);
  });
});
