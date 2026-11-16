import { describe, expect, it } from "vitest";
import { ESTADOS_DE_RECEPCION, MENSAJE_RECEPCION_NO_ENCONTRADA, MENSAJE_RECEPCION_YA_RECIBIDA, decidirConfirmacionDeRecepcion, estadoInicialDeLaParte, mensajeFechaDeStockFueraDeRango } from "@/core/compras/public";
import type { EntradaDeConfirmacionDeRecepcion } from "@/core/compras/public";

/** Las reglas PURAS de la recepción separada (Compras N3-a). La combinación completa contra el oráculo escrito aparte vive en `test/core/combinaciones-compras-recepcion.test.ts`; acá, los casos con nombre. */
const BASE: EntradaDeConfirmacionDeRecepcion = {
  esDeLaSucursalDelActor: true,
  facturaAnulada: false,
  estadoDeLaParte: "PENDIENTE",
  seccion: "PROPIA_ACTIVA",
  diaFactura: "2026-11-10",
  diaStock: "2026-11-12",
  hoy: "2026-11-15",
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
  it("una parte pendiente, de esta sucursal, con sección activa propia y fecha en rango: se puede", () => {
    expect(con({})).toEqual({ ok: true });
  });

  it("la fecha de stock vale desde el día de la factura hasta hoy, ambos incluidos", () => {
    expect(con({ diaStock: BASE.diaFactura })).toEqual({ ok: true });
    expect(con({ diaStock: BASE.hoy })).toEqual({ ok: true });
    for (const diaStock of ["2026-11-09", "2026-11-16"]) {
      expect(con({ diaStock })).toEqual({ ok: false, codigo: "FECHA_FUERA_DE_RANGO", mensaje: mensajeFechaDeStockFueraDeRango("2026-11-10", "2026-11-15") });
    }
    expect(mensajeFechaDeStockFueraDeRango("2026-11-10", "2026-11-15")).toBe("La fecha de stock tiene que estar entre la fecha de la factura (2026-11-10) y hoy (2026-11-15).");
  });

  it("orden de las razones: sucursal ajena → anulada → ya recibida → sección ajena → sección inactiva → fecha", () => {
    const todoMal = { esDeLaSucursalDelActor: false, facturaAnulada: true, estadoDeLaParte: "RECIBIDA", seccion: "AJENA", diaStock: "2026-12-31" } as const;
    expect(con(todoMal)).toMatchObject({ codigo: "NO_ES_DE_ESTA_SUCURSAL", mensaje: MENSAJE_RECEPCION_NO_ENCONTRADA });
    expect(con({ ...todoMal, esDeLaSucursalDelActor: true })).toMatchObject({ codigo: "YA_ANULADA" });
    expect(con({ ...todoMal, esDeLaSucursalDelActor: true, facturaAnulada: false })).toMatchObject({ codigo: "YA_RECIBIDA", mensaje: MENSAJE_RECEPCION_YA_RECIBIDA });
    expect(con({ ...todoMal, esDeLaSucursalDelActor: true, facturaAnulada: false, estadoDeLaParte: "PENDIENTE" })).toMatchObject({ codigo: "SECCION_NO_ENCONTRADA" });
    expect(con({ ...todoMal, esDeLaSucursalDelActor: true, facturaAnulada: false, estadoDeLaParte: "PENDIENTE", seccion: "INACTIVA" })).toMatchObject({ codigo: "SECCION_INACTIVA" });
    expect(con({ ...todoMal, esDeLaSucursalDelActor: true, facturaAnulada: false, estadoDeLaParte: "PENDIENTE", seccion: "PROPIA_ACTIVA" })).toMatchObject({ codigo: "FECHA_FUERA_DE_RANGO" });
  });

  it("los estados de recepción del código son los dos del CHECK de la base", () => {
    expect([...ESTADOS_DE_RECEPCION]).toEqual(["PENDIENTE", "RECIBIDA"]);
  });
});
