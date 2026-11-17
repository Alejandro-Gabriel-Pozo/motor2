import { describe, expect, it } from "vitest";
import { ESTADOS_DE_RECEPCION, MENSAJE_RECEPCION_NO_ENCONTRADA, decidirConfirmacionDeRecepcion, estadoInicialDeLaParte, validarEntradasDeRecepcion } from "@/core/compras/public";
import type { EntradaDeConfirmacionDeRecepcion } from "@/core/compras/public";

/** Las reglas PURAS de la recepción separada (Compras N3-a). La combinación completa contra el oráculo escrito aparte vive en `test/core/combinaciones-compras-recepcion.test.ts`; acá, los casos con nombre. */
const BASE: EntradaDeConfirmacionDeRecepcion = {
  esDeLaSucursalDelActor: true,
  facturaAnulada: false,
  estadoDeLaParte: "PENDIENTE",
  seccion: "PROPIA_ACTIVA",
};
const con = (cambios: Partial<EntradaDeConfirmacionDeRecepcion>) => decidirConfirmacionDeRecepcion({ ...BASE, ...cambios });

describe("estadoInicialDeLaParte", () => {
  it("solo con el módulo encendido y sin partes ajenas nace PENDIENTE", () => {
    expect(estadoInicialDeLaParte({ moduloEncendido: true, hayPartesAjenas: false })).toBe("PENDIENTE");
    expect(estadoInicialDeLaParte({ moduloEncendido: true, hayPartesAjenas: true })).toBe("RECIBIDA");
    expect(estadoInicialDeLaParte({ moduloEncendido: false, hayPartesAjenas: false })).toBe("RECIBIDA");
    expect(estadoInicialDeLaParte({ moduloEncendido: false, hayPartesAjenas: true })).toBe("RECIBIDA");
  });
});

describe("decidirConfirmacionDeRecepcion", () => {
  it("una parte pendiente, de esta sucursal, con sección activa propia: se puede (y no es una repetición)", () => {
    expect(con({})).toEqual({ ok: true, yaRecibida: false });
  });

  it("repetir confirmar (la parte ya está recibida) es ÉXITO con yaRecibida, sin mirar la sección (paridad con Pedernal: yaExistia)", () => {
    for (const seccion of ["PROPIA_ACTIVA", "AJENA", "INACTIVA"] as const) expect(con({ estadoDeLaParte: "RECIBIDA", seccion })).toEqual({ ok: true, yaRecibida: true });
  });

  it("orden de las razones: sucursal ajena → anulada → ya recibida (éxito) → sección ajena → sección inactiva", () => {
    const todoMal = { esDeLaSucursalDelActor: false, facturaAnulada: true, estadoDeLaParte: "RECIBIDA", seccion: "AJENA" } as const;
    expect(con(todoMal)).toMatchObject({ codigo: "NO_ES_DE_ESTA_SUCURSAL", mensaje: MENSAJE_RECEPCION_NO_ENCONTRADA });
    expect(con({ ...todoMal, esDeLaSucursalDelActor: true })).toMatchObject({ codigo: "YA_ANULADA" });
    expect(con({ ...todoMal, esDeLaSucursalDelActor: true, facturaAnulada: false })).toEqual({ ok: true, yaRecibida: true });
    expect(con({ ...todoMal, esDeLaSucursalDelActor: true, facturaAnulada: false, estadoDeLaParte: "PENDIENTE" })).toMatchObject({ codigo: "SECCION_NO_ENCONTRADA" });
    expect(con({ ...todoMal, esDeLaSucursalDelActor: true, facturaAnulada: false, estadoDeLaParte: "PENDIENTE", seccion: "INACTIVA" })).toMatchObject({ codigo: "SECCION_INACTIVA" });
  });

  it("los estados de recepción del código son los dos del CHECK de la base", () => {
    expect([...ESTADOS_DE_RECEPCION]).toEqual(["PENDIENTE", "RECIBIDA"]);
  });
});

describe("validarEntradasDeRecepcion: UN solo destino por renglón", () => {
  const renglones = ["r1", "r2"];

  it("cada renglón con su destino: sirve", () => {
    expect(validarEntradasDeRecepcion(renglones, [{ renglonId: "r1", seccionId: "s1" }, { renglonId: "r2", seccionId: "s2" }])).toEqual({ ok: true });
  });

  it("un renglón en dos secciones (dividido) o dos veces en la misma se rechaza: ENTRADA_REPETIDA", () => {
    for (const segunda of ["s2", "s1"]) {
      expect(validarEntradasDeRecepcion(renglones, [{ renglonId: "r1", seccionId: "s1" }, { renglonId: "r1", seccionId: segunda }, { renglonId: "r2", seccionId: "s1" }])).toMatchObject({ ok: false, codigo: "ENTRADA_REPETIDA" });
    }
  });

  it("sin entradas, un renglón ajeno y un renglón sin destino se rechazan con su código", () => {
    expect(validarEntradasDeRecepcion(renglones, [])).toMatchObject({ ok: false, codigo: "SIN_ENTRADAS" });
    expect(validarEntradasDeRecepcion(renglones, [{ renglonId: "otro", seccionId: "s1" }])).toMatchObject({ ok: false, codigo: "RENGLON_AJENO" });
    expect(validarEntradasDeRecepcion(renglones, [{ renglonId: "r1", seccionId: "s1" }])).toMatchObject({ ok: false, codigo: "RENGLON_SIN_ENTRADAS" });
  });
});
