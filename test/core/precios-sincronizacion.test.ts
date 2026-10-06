import { describe, expect, it } from "vitest";
import {
  alDeshabilitar,
  alSalirDelGrupo,
  evaluarActivacionSincronizado,
  filasAActualizarPorPropagacion,
  filasSincronizadasCompartenElMismoPrecio,
  puedeSincronizar,
} from "@/core/precios/sincronizacion";

describe("alDeshabilitar / alSalirDelGrupo", () => {
  it("deshabilitar apaga sincronizado en la misma operación (P5)", () => {
    expect(alDeshabilitar()).toEqual({ habilitado: false, sincronizado: false });
  });

  it("salir del grupo apaga sincronizado sin tocar el precio (P9/P10)", () => {
    expect(alSalirDelGrupo()).toEqual({ sincronizado: false });
  });
});

describe("puedeSincronizar", () => {
  it("rechaza si la fila no existe todavía", () => {
    expect(puedeSincronizar(null, true).ok).toBe(false);
  });

  it("rechaza si la sucursal no pertenece a ningún grupo", () => {
    expect(puedeSincronizar({ habilitado: true, precio: 10 }, false).ok).toBe(false);
  });

  it("rechaza si el precio local no está habilitado", () => {
    expect(puedeSincronizar({ habilitado: false, precio: 10 }, true).ok).toBe(false);
  });

  it("acepta con fila existente, habilitada y en un grupo", () => {
    expect(puedeSincronizar({ habilitado: true, precio: 10 }, true).ok).toBe(true);
  });
});

describe("evaluarActivacionSincronizado", () => {
  it("propaga el error de precondición si no se puede sincronizar", () => {
    const r = evaluarActivacionSincronizado(null, true, []);
    expect(r.ok).toBe(false);
  });

  it("sin pares prendidos, no requiere elección (P3)", () => {
    const r = evaluarActivacionSincronizado({ habilitado: true, precio: 10 }, true, []);
    expect(r).toEqual({ ok: true, requiereEleccion: false });
  });

  it("con pares al mismo precio, no requiere elección", () => {
    const r = evaluarActivacionSincronizado({ habilitado: true, precio: 10 }, true, [{ precio: 10 }]);
    expect(r).toEqual({ ok: true, requiereEleccion: false });
  });

  it("con pares a otro precio, requiere elección explícita — nunca decide en silencio", () => {
    const r = evaluarActivacionSincronizado({ habilitado: true, precio: 10 }, true, [{ precio: 15 }]);
    expect(r).toEqual({ ok: true, requiereEleccion: true, precioPropio: 10, precioDelGrupo: 15 });
  });
});

describe("filasAActualizarPorPropagacion", () => {
  const base = { sucursalId: "suc-a", productoId: "prod-1", grupoId: "grupo-1" };

  it("sin grupo, no propaga a nadie", () => {
    const r = filasAActualizarPorPropagacion(
      { ...base, grupoId: null },
      [{ sucursalId: "suc-b", productoId: "prod-1", grupoId: "grupo-1", sincronizado: true, habilitado: true }]
    );
    expect(r).toEqual([]);
  });

  it("filtra por mismo producto, mismo grupo, sincronizado y habilitado (P2)", () => {
    const candidatas = [
      { sucursalId: "suc-b", productoId: "prod-1", grupoId: "grupo-1", sincronizado: true, habilitado: true }, // par válido
      { sucursalId: "suc-c", productoId: "prod-1", grupoId: "grupo-1", sincronizado: false, habilitado: true }, // apagado
      { sucursalId: "suc-d", productoId: "prod-1", grupoId: "grupo-1", sincronizado: true, habilitado: false }, // deshabilitado
      { sucursalId: "suc-e", productoId: "prod-2", grupoId: "grupo-1", sincronizado: true, habilitado: true }, // otro producto
      { sucursalId: "suc-f", productoId: "prod-1", grupoId: "grupo-2", sincronizado: true, habilitado: true }, // otro grupo
      { sucursalId: "suc-a", productoId: "prod-1", grupoId: "grupo-1", sincronizado: true, habilitado: true }, // la propia fila
    ];
    const r = filasAActualizarPorPropagacion(base, candidatas);
    expect(r).toEqual([candidatas[0]]);
  });

  it("nunca crea filas: un par sin fila candidata simplemente no aparece (P7)", () => {
    const r = filasAActualizarPorPropagacion(base, []);
    expect(r).toEqual([]);
  });
});

describe("filasSincronizadasCompartenElMismoPrecio", () => {
  it("true si no hay ninguna fila sincronizada", () => {
    expect(filasSincronizadasCompartenElMismoPrecio([{ precio: 10, sincronizado: false }])).toBe(true);
  });

  it("true si todas las sincronizadas comparten precio (las apagadas no cuentan)", () => {
    expect(
      filasSincronizadasCompartenElMismoPrecio([
        { precio: 10, sincronizado: true },
        { precio: 10, sincronizado: true },
        { precio: 999, sincronizado: false },
      ])
    ).toBe(true);
  });

  it("false si dos sincronizadas divergen de precio", () => {
    expect(
      filasSincronizadasCompartenElMismoPrecio([
        { precio: 10, sincronizado: true },
        { precio: 15, sincronizado: true },
      ])
    ).toBe(false);
  });
});
