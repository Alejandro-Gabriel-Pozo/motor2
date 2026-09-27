import { describe, expect, it } from "vitest";
import {
  guardComandoAceptarTraspaso,
  guardComandoAprobarYEnviarTraspaso,
  guardComandoCancelarSolicitudTraspaso,
  guardComandoConfirmarReingresoTraspaso,
  guardComandoRechazarEnvioTraspaso,
  guardComandoRechazarSolicitudTraspaso,
} from "../../../../src/core/features/traspasos/traspaso-comandos.guard";

/**
 * Guards de los comandos de traspasos (src/core/features/traspasos/traspaso-comandos.guard.ts; Task #41, Fases M11a y M11b): formato,
 * puros.
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

const CLAVE = "3f2b8a1e-4c5d-4e6f-8a7b-9c0d1e2f3a4b";
const CLAVE_INVALIDA = { ok: false, codigo: "formato", mensaje: "Clave de reintento inválida." };

describe("guardComandoAceptarTraspaso", () => {
  it("normaliza el id, deja pasar la sección tal cual y la clave ausente queda en null", () => {
    expect(guardComandoAceptarTraspaso({ id: " t-1 ", seccionDestinoId: "sec-1" })).toEqual({
      ok: true,
      valor: { traspasoId: "t-1", seccionDestinoId: "sec-1", claveIdempotencia: null },
    });
    expect(guardComandoAceptarTraspaso({ id: "t-1", seccionDestinoId: "sec-1", claveIdempotencia: CLAVE })).toEqual({
      ok: true,
      valor: { traspasoId: "t-1", seccionDestinoId: "sec-1", claveIdempotencia: CLAVE },
    });
  });

  it("orden de antes: primero el id, después la clave, después la sección", () => {
    expect(guardComandoAceptarTraspaso({ id: "", seccionDestinoId: 42, claveIdempotencia: "x" })).toEqual(FALTA);
    expect(guardComandoAceptarTraspaso({ id: "t-1", seccionDestinoId: 42, claveIdempotencia: "x" })).toEqual(CLAVE_INVALIDA);
  });

  it.each([null, "", "no-es-un-uuid", 42])("clave %j (presente pero no UUID): «Clave de reintento inválida.», como antes", (claveIdempotencia) => {
    expect(guardComandoAceptarTraspaso({ id: "t-1", seccionDestinoId: "sec-1", claveIdempotencia })).toEqual(CLAVE_INVALIDA);
  });

  it.each([undefined, null, 42])("seccionDestinoId %j: el mismo mensaje que «no es una sección propia», sin llegar a la base", (seccionDestinoId) => {
    expect(guardComandoAceptarTraspaso({ id: "t-1", seccionDestinoId })).toEqual({ ok: false, codigo: "formato", mensaje: "Elegí a qué sección propia entra." });
  });
});

describe("guardComandoRechazarEnvioTraspaso", () => {
  it("normaliza el id y el motivo (texto(motivo) || null, como antes)", () => {
    expect(guardComandoRechazarEnvioTraspaso({ id: " t-1", motivo: "  No lo pedimos " })).toEqual({ ok: true, valor: { traspasoId: "t-1", motivo: "No lo pedimos" } });
    expect(guardComandoRechazarEnvioTraspaso({ id: "t-1" })).toEqual({ ok: true, valor: { traspasoId: "t-1", motivo: null } });
  });

  it.each([undefined, null, "", "  "])("id %j: «Falta el traspaso.»", (id) => {
    expect(guardComandoRechazarEnvioTraspaso({ id, motivo: "x" })).toEqual(FALTA);
  });
});

describe("guardComandoConfirmarReingresoTraspaso", () => {
  it("normaliza el id; clave ausente → null, clave UUID pasa", () => {
    expect(guardComandoConfirmarReingresoTraspaso({ id: " t-1 " })).toEqual({ ok: true, valor: { traspasoId: "t-1", claveIdempotencia: null } });
    expect(guardComandoConfirmarReingresoTraspaso({ id: "t-1", claveIdempotencia: CLAVE })).toEqual({ ok: true, valor: { traspasoId: "t-1", claveIdempotencia: CLAVE } });
  });

  it("id vacío antes que la clave; clave inválida después", () => {
    expect(guardComandoConfirmarReingresoTraspaso({ id: "", claveIdempotencia: "x" })).toEqual(FALTA);
    expect(guardComandoConfirmarReingresoTraspaso({ id: "t-1", claveIdempotencia: "x" })).toEqual(CLAVE_INVALIDA);
  });
});
