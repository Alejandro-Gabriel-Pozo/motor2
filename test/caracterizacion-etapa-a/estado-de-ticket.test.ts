import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { estadoDeTicket } from "../../src/core/pos/ticket";

/**
 * Caracterización (Etapa A, punto 4c): `estadoDeTicket(items, impresaEn)` — el estado de un ejemplar de ticket NO se guarda, se deriva de las anulaciones de
 * las Operaciones VENTA de la cuenta comparadas con el instante en que se imprimió. Función pura: el único «ahora» es la constante `IMPRESA_EN`.
 */
const IMPRESA_EN = new Date("2026-09-15T12:00:00Z");
const ANTES = new Date("2026-09-15T11:00:00Z");
const DESPUES = new Date("2026-09-15T13:00:00Z");

describe("estadoDeTicket", () => {
  it("sin ítems con operación: vigente", () => {
    expect(estadoDeTicket([], IMPRESA_EN)).toBe("vigente");
  });

  it("una anulación exactamente en el instante de impresión: vigente (la comparación es estricta)", () => {
    expect(estadoDeTicket([{ operacionId: "op1", anuladaEn: IMPRESA_EN }, { operacionId: "op2", anuladaEn: null }], IMPRESA_EN)).toBe("vigente");
  });

  it("una anulación anterior a la impresión: vigente (el ticket ya la reflejaba)", () => {
    expect(estadoDeTicket([{ operacionId: "op1", anuladaEn: ANTES }, { operacionId: "op2", anuladaEn: null }], IMPRESA_EN)).toBe("vigente");
  });

  it("una anulación posterior en una sola parte: desactualizada", () => {
    expect(estadoDeTicket([{ operacionId: "op1", anuladaEn: DESPUES }, { operacionId: "op2", anuladaEn: null }], IMPRESA_EN)).toBe("desactualizada");
  });

  it("todas las operaciones anuladas, aunque sea después de imprimir: anulada (gana sobre desactualizada)", () => {
    expect(estadoDeTicket([{ operacionId: "op1", anuladaEn: DESPUES }, { operacionId: "op2", anuladaEn: DESPUES }], IMPRESA_EN)).toBe("anulada");
    // Con una anterior y otra posterior también: todas anuladas manda.
    expect(estadoDeTicket([{ operacionId: "op1", anuladaEn: ANTES }, { operacionId: "op2", anuladaEn: DESPUES }], IMPRESA_EN)).toBe("anulada");
  });

  it("ítems repetidos de la misma operación cuentan una sola vez", () => {
    // Dos ítems de la misma operación anulada + una operación vigente: NO es «todas anuladas» (son 1 de 2 operaciones).
    expect(
      estadoDeTicket(
        [
          { operacionId: "op1", anuladaEn: DESPUES },
          { operacionId: "op1", anuladaEn: DESPUES },
          { operacionId: "op2", anuladaEn: null },
        ],
        IMPRESA_EN
      )
    ).toBe("desactualizada");
    // Una sola operación anulada repetida en varios ítems: una operación, anulada.
    expect(estadoDeTicket([{ operacionId: "op1", anuladaEn: DESPUES }, { operacionId: "op1", anuladaEn: DESPUES }], IMPRESA_EN)).toBe("anulada");
  });

  it("los ítems sin operacionId se ignoran", () => {
    expect(estadoDeTicket([{ operacionId: null, anuladaEn: null }, { operacionId: null, anuladaEn: DESPUES }], IMPRESA_EN)).toBe("vigente");
    expect(estadoDeTicket([{ operacionId: null, anuladaEn: null }, { operacionId: "op1", anuladaEn: DESPUES }], IMPRESA_EN)).toBe("anulada");
  });
});

describe("EjemplarTicket no guarda lo que se deriva", () => {
  it("el modelo no tiene columnas de total, importe ni estado (se calculan de los ítems y las anulaciones)", () => {
    const columnas = Object.keys(Prisma.EjemplarTicketScalarFieldEnum);
    expect(columnas).toContain("emitidoEn"); // el enum existe y es el del modelo correcto
    for (const derivada of ["total", "importe", "estado"]) expect(columnas).not.toContain(derivada);
  });
});
