import { describe, expect, it } from "vitest";
import { capacidadesDelProducto } from "@/core/catalogo/capacidades-del-producto";
import { tieneStockReal } from "@/core/movimientos/transiciones";
import { esperadoPara, MP_QUE_NO_SE_PRODUCE, MP_QUE_SE_PRODUCE, NADA_PUEDE, PV_QUE_NO_SE_PRODUCE, PV_QUE_SE_PRODUCE, REVENTA_COHERENTE } from "./capacidades-del-producto-oraculo";

/**
 * E4-0 de la Reventa (docs/diseno-reventa-e4-2026-11-17.md §3, §7 y §8): `capacidadesDelProducto` es el punto único de «qué puede hacer un producto». Esta prueba es la EQUIVALENCIA: recorre TODAS las
 * combinaciones tipo × se produce × clase de uso (incluidas las incoherentes y las desconocidas) contra el oráculo escrito aparte, y fija que lo que existe hoy no cambia de resultado.
 */
const TIPOS = ["MP", "PV", "mp", "pv", "", "SERVICIO"] as const;
const SE_PRODUCE = [true, false] as const;
const CLASES: ReadonlyArray<string | null | undefined> = [undefined, null, "", "MATERIA_PRIMA", "INSUMO", "ELABORADO", "VENDIBLE", "REVENTA", "reventa", "foo"];

describe("capacidadesDelProducto: equivalencia con lo que hoy deciden los literales", () => {
  const combinaciones = TIPOS.flatMap((tipo) => SE_PRODUCE.flatMap((seProduce) => CLASES.map((claseDeUso) => ({ tipo, seProduce, claseDeUso }))));

  it("recorre todas las combinaciones (sanidad: no pasa en vacío)", () => {
    expect(combinaciones).toHaveLength(TIPOS.length * SE_PRODUCE.length * CLASES.length);
  });

  it.each(combinaciones)("tipo «$tipo», se produce $seProduce, clase «$claseDeUso» da lo del oráculo", ({ tipo, seProduce, claseDeUso }) => {
    expect(capacidadesDelProducto({ tipo, seProduce, claseDeUso })).toEqual(esperadoPara(tipo, seProduce, claseDeUso));
  });

  it("las cuatro formas que existen hoy dan la tabla de hoy, con o sin clase (la clase no cambia nada salvo REVENTA)", () => {
    for (const claseDeUso of [undefined, null, "MATERIA_PRIMA", "INSUMO", "ELABORADO", "VENDIBLE"]) {
      expect(capacidadesDelProducto({ tipo: "MP", seProduce: false, claseDeUso })).toEqual(MP_QUE_NO_SE_PRODUCE);
      expect(capacidadesDelProducto({ tipo: "MP", seProduce: true, claseDeUso })).toEqual(MP_QUE_SE_PRODUCE);
      expect(capacidadesDelProducto({ tipo: "PV", seProduce: false, claseDeUso })).toEqual(PV_QUE_NO_SE_PRODUCE);
      expect(capacidadesDelProducto({ tipo: "PV", seProduce: true, claseDeUso })).toEqual(PV_QUE_SE_PRODUCE);
    }
  });

  it("REVENTA: un producto de venta que no se produce se compra, se vende y lleva stock propio; incoherente o desconocida, no puede nada", () => {
    expect(capacidadesDelProducto({ tipo: "PV", seProduce: false, claseDeUso: "REVENTA" })).toEqual(REVENTA_COHERENTE);
    expect(capacidadesDelProducto({ tipo: "MP", seProduce: false, claseDeUso: "REVENTA" })).toEqual(NADA_PUEDE);
    expect(capacidadesDelProducto({ tipo: "PV", seProduce: true, claseDeUso: "REVENTA" })).toEqual(NADA_PUEDE);
    expect(capacidadesDelProducto({ tipo: "PV", seProduce: false, claseDeUso: "reventa" })).toEqual(PV_QUE_NO_SE_PRODUCE); // una clase que no es de la lista no cambia nada: cae en lo de hoy
  });

  it("un tipo desconocido no puede nada (todo nace cerrado)", () => {
    for (const seProduce of SE_PRODUCE) expect(capacidadesDelProducto({ tipo: "SERVICIO", seProduce })).toEqual(NADA_PUEDE);
  });

  it("`tieneStockReal` (el primer circuito que lo usa) da el mismo resultado que su fórmula de siempre", () => {
    for (const tipo of ["MP", "PV"] as const) for (const seProduce of SE_PRODUCE) expect(tieneStockReal(tipo, seProduce)).toBe(tipo === "MP" || (tipo === "PV" && seProduce));
  });

  it("idempotencia y pureza: repetir la pregunta da lo mismo y no toca la entrada", () => {
    const entrada = Object.freeze({ tipo: "PV", seProduce: false, claseDeUso: "REVENTA" });
    expect(capacidadesDelProducto(entrada)).toEqual(capacidadesDelProducto(entrada));
  });
});
