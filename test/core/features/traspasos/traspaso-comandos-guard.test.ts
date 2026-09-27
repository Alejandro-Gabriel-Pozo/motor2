import { describe, expect, it } from "vitest";
import {
  guardComandoAprobarYEnviarTraspaso,
  guardComandoCancelarSolicitudTraspaso,
  guardComandoRechazarSolicitudTraspaso,
} from "../../../../src/core/features/traspasos/traspaso-comandos.guard";

/**
 * Guards de los comandos de traspasos (src/core/features/traspasos/traspaso-comandos.guard.ts; Task #41, Fase M11a): formato, puros.
 * Los textos son los que ya devolvían las Server Actions (test/traspasos/traspasos.test.ts los sigue cubriendo de punta a punta).
 */
const FALTA = { ok: false, codigo: "vacio", mensaje: "Falta el traspaso." };

describe("guardComandoAprobarYEnviarTraspaso", () => {
  it("normaliza el id con texto() (recorta) y deja pasar la sección tal cual", () => {
    expect(guardComandoAprobarYEnviarTraspaso({ id: "  t-1 ", seccionOrigenId: "sec-1" })).toEqual({ ok: true, valor: { traspasoId: "t-1", seccionOrigenId: "sec-1" } });
    // Un string vacío también pasa: que la sección sea propia lo decide el caso de uso contra la base (mismo mensaje).
    expect(guardComandoAprobarYEnviarTraspaso({ id: "t-1", seccionOrigenId: "" })).toEqual({ ok: true, valor: { traspasoId: "t-1", seccionOrigenId: "" } });
  });

  it.each([undefined, null, "", "   "])("id %j: «Falta el traspaso.» — antes que la sección, como antes", (id) => {
    expect(guardComandoAprobarYEnviarTraspaso({ id, seccionOrigenId: 42 })).toEqual(FALTA);
  });

  it.each([undefined, null, 42, { id: "sec-1" }])("seccionOrigenId %j: el mismo mensaje que «no es una sección propia», sin llegar a la base", (seccionOrigenId) => {
    expect(guardComandoAprobarYEnviarTraspaso({ id: "t-1", seccionOrigenId })).toEqual({ ok: false, codigo: "formato", mensaje: "Elegí de qué sección propia sale." });
  });

  it("sin entrada: rechaza por el id", () => {
    expect(guardComandoAprobarYEnviarTraspaso(undefined)).toEqual(FALTA);
  });
});

describe("guardComandoCancelarSolicitudTraspaso", () => {
  it("normaliza el id", () => {
    expect(guardComandoCancelarSolicitudTraspaso({ id: " t-1 " })).toEqual({ ok: true, valor: { traspasoId: "t-1" } });
  });

  it.each([undefined, null, "", "  "])("id %j: «Falta el traspaso.»", (id) => {
    expect(guardComandoCancelarSolicitudTraspaso({ id })).toEqual(FALTA);
  });
});

describe("guardComandoRechazarSolicitudTraspaso", () => {
  it("normaliza el id y el motivo (texto(motivo) || null, como antes)", () => {
    expect(guardComandoRechazarSolicitudTraspaso({ id: "t-1", motivo: "  No tenemos  " })).toEqual({ ok: true, valor: { traspasoId: "t-1", motivo: "No tenemos" } });
  });

  it.each([undefined, null, "", "   "])("motivo %j: queda en null", (motivo) => {
    expect(guardComandoRechazarSolicitudTraspaso({ id: "t-1", motivo })).toEqual({ ok: true, valor: { traspasoId: "t-1", motivo: null } });
  });

  it("id vacío: «Falta el traspaso.»", () => {
    expect(guardComandoRechazarSolicitudTraspaso({ id: "", motivo: "x" })).toEqual(FALTA);
  });
});
