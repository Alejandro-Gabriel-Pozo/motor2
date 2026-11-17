import { describe, expect, it } from "vitest";

import type { TipoProducto } from "../../src/core/datos/enumerados-del-esquema";
import { productoValidoParaProceso, seVendeDeSuStockPropio, tieneStockReal } from "../../src/core/movimientos/transiciones";
import { esperadoPara } from "./capacidades-del-producto-oraculo";

/**
 * E4-3a de la Reventa (docs/diseno-reventa-e4-2026-11-17.md §7): el circuito de STOCK y de VENTA decide «lleva stock propio» y «se vende de su stock propio (sin receta)» con `capacidadesDelProducto`.
 * Recorre TODAS las combinaciones tipo × se produce × clase de uso contra el ORÁCULO escrito aparte y fija:
 *  (a) `tieneStockReal(tipo, seProduce, clase)` da `tieneStockPropio` del oráculo;
 *  (b) `seVendeDeSuStockPropio` da `seVende && tieneStockPropio` del oráculo (PV que se produce y Reventa; nunca una MP);
 *  (c) EQUIVALENCIA con lo de SIEMPRE: sin REVENTA, `tieneStockReal` es «MP, o PV que se produce» y `seVendeDeSuStockPropio` es «PV que se produce» (los literales que reemplazan);
 *  (d) los procesos que exigen stock real (consumo, merma, ajuste, traspaso…) admiten una Reventa y siguen igual para todo lo demás.
 */
const TIPOS = ["MP", "PV", "mp", "", "SERVICIO"] as const;
const SE_PRODUCE = [true, false] as const;
const CLASES: ReadonlyArray<string | null | undefined> = [undefined, null, "", "MATERIA_PRIMA", "INSUMO", "ELABORADO", "VENDIBLE", "REVENTA", "reventa", "foo"];
const COMBINACIONES = TIPOS.flatMap((tipo) => SE_PRODUCE.flatMap((seProduce) => CLASES.map((claseDeUso) => ({ tipo, seProduce, claseDeUso }))));

describe("stock propio y venta de stock propio contra el oráculo", () => {
  it("recorre todas las combinaciones (sanidad: no pasa en vacío)", () => {
    expect(COMBINACIONES).toHaveLength(TIPOS.length * SE_PRODUCE.length * CLASES.length);
  });

  it.each(COMBINACIONES)("tipo «$tipo», se produce $seProduce, clase «$claseDeUso»", ({ tipo, seProduce, claseDeUso }) => {
    const esperado = esperadoPara(tipo, seProduce, claseDeUso);
    expect(tieneStockReal(tipo as TipoProducto, seProduce, claseDeUso)).toBe(esperado.tieneStockPropio);
    expect(seVendeDeSuStockPropio(tipo as TipoProducto, seProduce, claseDeUso)).toBe(esperado.seVende && esperado.tieneStockPropio);
  });

  it("equivalencia con lo de siempre: sin REVENTA, stock propio = MP o PV que se produce; venta de stock propio = PV que se produce", () => {
    for (const claseDeUso of [undefined, null, "MATERIA_PRIMA", "INSUMO", "ELABORADO", "VENDIBLE", "reventa", ""]) {
      for (const seProduce of SE_PRODUCE) {
        expect(tieneStockReal("MP", seProduce, claseDeUso)).toBe(true);
        expect(tieneStockReal("PV", seProduce, claseDeUso)).toBe(seProduce);
        expect(seVendeDeSuStockPropio("MP", seProduce, claseDeUso)).toBe(false);
        expect(seVendeDeSuStockPropio("PV", seProduce, claseDeUso)).toBe(seProduce);
      }
    }
    // Sin el argumento nuevo (como lo llamaban todos hasta ahora).
    expect(tieneStockReal("MP", false)).toBe(true);
    expect(tieneStockReal("PV", false)).toBe(false);
    expect(tieneStockReal("PV", true)).toBe(true);
  });

  it("una REVENTA coherente tiene stock propio y se vende de él; incoherente (MP o se produce) o de un tipo desconocido, no (todo nace cerrado)", () => {
    expect(tieneStockReal("PV", false, "REVENTA")).toBe(true);
    expect(seVendeDeSuStockPropio("PV", false, "REVENTA")).toBe(true);
    expect(tieneStockReal("MP", false, "REVENTA")).toBe(false);
    expect(tieneStockReal("PV", true, "REVENTA")).toBe(false);
    expect(seVendeDeSuStockPropio("PV", true, "REVENTA")).toBe(false);
    expect(tieneStockReal("SERVICIO" as TipoProducto, false, "REVENTA")).toBe(false);
  });

  it("los procesos que piden stock real admiten una Reventa; Producción sigue siendo solo de lo que se produce", () => {
    const reventa = { tipo: "PV" as const, seProduce: false, esConsignacion: false, claseDeUso: "REVENTA" };
    const pvComun = { tipo: "PV" as const, seProduce: false, esConsignacion: false, claseDeUso: "VENDIBLE" };
    for (const proceso of ["CONSUMO", "MERMA", "AJUSTE", "DEVOLUCION_PROVEEDOR"] as const) {
      expect(productoValidoParaProceso(proceso, reventa), proceso).toBe(true);
      expect(productoValidoParaProceso(proceso, pvComun), proceso).toBe(false);
    }
    expect(productoValidoParaProceso("PRODUCCION", reventa)).toBe(false);
  });
});
