import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { resolverDisponibilidad, resolverDisponibilidadPorSucursal } from "../../src/core/catalogo/disponibilidad-producto";
import { filtrarPreciosLocalesVigentes } from "../../src/core/catalogo/precio-local";
import { rendimientoEfectivo } from "../../src/core/catalogo/rendimiento-local";
import { aplicarDescuentoDeProducto } from "../../src/core/carta/descuento-producto";
import { precioDePromo } from "../../src/core/carta/promo-sucursal";
import { elegirMinimo } from "../../src/core/stock/stock-minimo";
import { resolverProximoConteo } from "../../src/core/stock/frecuencia-conteo";
import { sucursalTieneCapacidad } from "../../src/core/permisos/capacidades-sucursal";

/**
 * CARACTERIZACIÓN (ADR-009): qué significa "no hay fila" en cada resolver puro por sucursal, una familia por bloque. Si una semántica de
 * ausencia cambia, este archivo lo muestra en rojo: el cambio tiene que ser una decisión, no un efecto colateral. El registro de modelos y
 * familias está en `test/arquitectura/semantica-sin-fila.test.ts`.
 */
describe("familia opt-in: sin fila = NO", () => {
  it("disponibilidad: sin fila (null/undefined) o disponible=false => no disponible", () => {
    expect(resolverDisponibilidad(null)).toBe(false);
    expect(resolverDisponibilidad(undefined)).toBe(false);
    expect(resolverDisponibilidad({ disponible: false })).toBe(false);
    expect(resolverDisponibilidad({ disponible: true })).toBe(true);
  });

  it("disponibilidad por sucursal: la sucursal sin fila queda en false", () => {
    const r = resolverDisponibilidadPorSucursal([{ sucursalId: "A", disponible: true }], ["A", "B"]);
    expect([...r]).toEqual([["A", true], ["B", false]]);
  });
});

describe("familia override: sin fila = vale el valor de la empresa", () => {
  it("precio local: sin fila, o con la fila deshabilitada, o con la capacidad apagada => no hay precio local vigente", () => {
    expect(filtrarPreciosLocalesVigentes([], true).size).toBe(0);
    expect(filtrarPreciosLocalesVigentes([{ productoId: "p", precio: 90, habilitado: false }], true).size).toBe(0);
    expect(filtrarPreciosLocalesVigentes([{ productoId: "p", precio: 90, habilitado: true }], false).size).toBe(0);
    expect(filtrarPreciosLocalesVigentes([{ productoId: "p", precio: 90, habilitado: true }], true).get("p")).toEqual({ precio: 90, habilitado: true });
  });

  it("rendimiento: sin override rige el central; el override parcial hereda lo que no define", () => {
    const central = { cantidad: 1, mermaPorcentaje: 10 };
    expect(rendimientoEfectivo(central, undefined, "A")).toEqual({ cantidad: 1, mermaPorcentaje: 10, calibrado: false });
    expect(rendimientoEfectivo(central, [{ sucursalId: "B", cantidad: 2, mermaPorcentaje: 5 }], "A")).toEqual({ cantidad: 1, mermaPorcentaje: 10, calibrado: false });
    expect(rendimientoEfectivo(central, [{ sucursalId: "A", cantidad: 2, mermaPorcentaje: null }], "A")).toEqual({ cantidad: 2, mermaPorcentaje: 10, calibrado: true });
  });

  it("precio de promo: sin fila o con precioLocal null => precio de la empresa", () => {
    expect(precioDePromo(25000, undefined)).toBe(25000);
    expect(precioDePromo(25000, { precioLocal: null })).toBe(25000);
    expect(precioDePromo(25000, { precioLocal: 22000 })).toBe(22000);
  });
});

describe("familia ajuste opcional: sin fila = no aplica", () => {
  it("descuento de producto: sin fila (null/undefined) o 0 => sin descuento, precio intacto", () => {
    const intacto = { precio: 1000, precioLista: null, porcentaje: null };
    expect(aplicarDescuentoDeProducto(1000, null)).toEqual(intacto);
    expect(aplicarDescuentoDeProducto(1000, undefined)).toEqual(intacto);
    expect(aplicarDescuentoDeProducto(1000, 0)).toEqual(intacto);
    expect(aplicarDescuentoDeProducto(1000, 10)).toEqual({ precio: 900, precioLista: 1000, porcentaje: 10 });
  });

  it("stock mínimo: sin ninguna fila => null (sin mínimo, sin alerta); un 0 es un mínimo real", () => {
    expect(elegirMinimo(undefined, undefined)).toBeNull();
    expect(elegirMinimo(null, null)).toBeNull();
    expect(elegirMinimo(0, 5)).toBe(0);
  });

  it("frecuencia de conteo: sin frecuencia (0) => nunca vence ni tiene próxima fecha", () => {
    const hoy = new Date("2026-10-01T00:00:00Z");
    expect(resolverProximoConteo({ ultimaFechaConteo: null, frecuenciaDias: 0, hoy })).toEqual({ proximaFecha: null, diasDeAtraso: null, vencido: false });
    expect(resolverProximoConteo({ ultimaFechaConteo: null, frecuenciaDias: 7, hoy })).toEqual({ proximaFecha: null, diasDeAtraso: null, vencido: true });
  });
});

describe("familia opt-out: sin fila = SÍ", () => {
  const dbCon = (filas: { accionClave: string; sucursalId: string | null; habilitado: boolean }[]) =>
    ({ capacidadSucursal: { findMany: async () => filas } }) as unknown as PrismaClient;

  it("capacidad: sin ninguna fila => habilitada", async () => {
    expect(await sucursalTieneCapacidad("A", "precio_local", dbCon([]))).toBe(true);
  });

  it("capacidad: la fila específica de la sucursal gana sobre la de empresa (null); la de empresa apaga si no hay específica", async () => {
    const apagadaPorEmpresa = [{ accionClave: "precio_local", sucursalId: null, habilitado: false }];
    expect(await sucursalTieneCapacidad("A", "precio_local", dbCon(apagadaPorEmpresa))).toBe(false);
    expect(await sucursalTieneCapacidad("A", "precio_local", dbCon([...apagadaPorEmpresa, { accionClave: "precio_local", sucursalId: "A", habilitado: true }]))).toBe(true);
  });
});
