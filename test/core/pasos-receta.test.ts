import { describe, expect, it } from "vitest";
import { renumerar, esPermutacionExacta, aplicarSecuencia, secuenciaMoviendo, insertarEnPosicion } from "@/core/catalogo/pasos-receta";

// Sin base de datos: toda esta aritmética es pura.

describe("renumerar", () => {
  it("renumera 1..N en el orden del array, arreglando huecos", () => {
    const pasos = [{ orden: 2, x: "a" }, { orden: 3, x: "b" }, { orden: 5, x: "c" }];
    expect(renumerar(pasos).map((p) => p.orden)).toEqual([1, 2, 3]);
    expect(renumerar(pasos).map((p) => p.x)).toEqual(["a", "b", "c"]);
  });
});

describe("esPermutacionExacta", () => {
  it("acepta una permutación válida", () => {
    expect(esPermutacionExacta([3, 1, 2], [1, 2, 3])).toBe(true);
  });

  it("rechaza un orden repetido", () => {
    expect(esPermutacionExacta([1, 1, 3], [1, 2, 3])).toBe(false);
  });

  it("rechaza una secuencia a la que le falta un orden", () => {
    expect(esPermutacionExacta([1, 2], [1, 2, 3])).toBe(false);
  });

  it("rechaza un orden que no está en la vigente", () => {
    expect(esPermutacionExacta([1, 2, 4], [1, 2, 3])).toBe(false);
  });
});

describe("aplicarSecuencia", () => {
  it("permuta los objetos enteros y renumera 1..N", () => {
    const pasos = [
      { orden: 1, instruccion: "Amasar", insumoProductoIds: ["harina"] },
      { orden: 2, instruccion: "Hornear", insumoProductoIds: ["levadura"] },
    ];
    const resultado = aplicarSecuencia(pasos, [2, 1]);
    expect(resultado).toEqual([
      { orden: 1, instruccion: "Hornear", insumoProductoIds: ["levadura"] },
      { orden: 2, instruccion: "Amasar", insumoProductoIds: ["harina"] },
    ]);
  });

  it("los ingredientes de cada paso viajan pegados al paso, no se quedan en la posición vieja", () => {
    const pasos = [
      { orden: 1, insumoProductoIds: ["A"] },
      { orden: 2, insumoProductoIds: ["B"] },
      { orden: 3, insumoProductoIds: ["C"] },
    ];
    const resultado = aplicarSecuencia(pasos, [3, 1, 2]);
    expect(resultado.find((p) => p.orden === 1)?.insumoProductoIds).toEqual(["C"]);
    expect(resultado.find((p) => p.orden === 2)?.insumoProductoIds).toEqual(["A"]);
    expect(resultado.find((p) => p.orden === 3)?.insumoProductoIds).toEqual(["B"]);
  });
});

describe("secuenciaMoviendo", () => {
  it("sube un paso del medio", () => {
    expect(secuenciaMoviendo([1, 2, 3], 2, "arriba")).toEqual([2, 1, 3]);
  });

  it("baja un paso del medio", () => {
    expect(secuenciaMoviendo([1, 2, 3], 2, "abajo")).toEqual([1, 3, 2]);
  });

  it("subir el primero devuelve la misma secuencia (sin cambios)", () => {
    expect(secuenciaMoviendo([1, 2, 3], 1, "arriba")).toEqual([1, 2, 3]);
  });

  it("bajar el último devuelve la misma secuencia (sin cambios)", () => {
    expect(secuenciaMoviendo([1, 2, 3], 3, "abajo")).toEqual([1, 2, 3]);
  });
});

describe("insertarEnPosicion", () => {
  it("inserta en el medio y renumera, conservando instrucción e ingredientes de los demás", () => {
    const pasos = [
      { orden: 1, instruccion: "Amasar", insumoProductoIds: ["harina"] },
      { orden: 2, instruccion: "Hornear", insumoProductoIds: ["levadura"] },
      { orden: 3, instruccion: "Enfriar", insumoProductoIds: [] as string[] },
    ];
    const nuevo = { orden: -1, instruccion: "Leudar", insumoProductoIds: [] as string[] };
    const resultado = insertarEnPosicion(pasos, 2, nuevo);
    expect(resultado.map((p) => p.instruccion)).toEqual(["Amasar", "Leudar", "Hornear", "Enfriar"]);
    expect(resultado.map((p) => p.orden)).toEqual([1, 2, 3, 4]);
    expect(resultado[2].insumoProductoIds).toEqual(["levadura"]);
  });

  it("insertar en una posición fuera de rango se recorta al principio o al final", () => {
    const pasos = [{ orden: 1, instruccion: "A" }, { orden: 2, instruccion: "B" }];
    const nuevo = { orden: -1, instruccion: "Nuevo" };
    expect(insertarEnPosicion(pasos, 0, nuevo).map((p) => p.instruccion)).toEqual(["Nuevo", "A", "B"]);
    expect(insertarEnPosicion(pasos, 99, nuevo).map((p) => p.instruccion)).toEqual(["A", "B", "Nuevo"]);
  });
});
