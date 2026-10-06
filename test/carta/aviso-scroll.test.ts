import { describe, expect, it } from "vitest";
import { hayMasParaVer } from "../../src/components/carta-publica/aviso-scroll";

describe("hayMasParaVer (aviso de scroll de la carta)", () => {
  it("contenido que entra: no hay más", () => {
    expect(hayMasParaVer({ scrollTop: 0, clientHeight: 500, scrollHeight: 500 })).toBe(false);
  });

  it("contenido más alto que el contenedor y arriba de todo: hay más", () => {
    expect(hayMasParaVer({ scrollTop: 0, clientHeight: 500, scrollHeight: 900 })).toBe(true);
  });

  it("scrolleado hasta el final: no hay más", () => {
    expect(hayMasParaVer({ scrollTop: 400, clientHeight: 500, scrollHeight: 900 })).toBe(false);
  });

  it("a mitad de camino: hay más", () => {
    expect(hayMasParaVer({ scrollTop: 200, clientHeight: 500, scrollHeight: 900 })).toBe(true);
  });

  it("la tolerancia absorbe el redondeo de subpíxeles (4px por defecto) pero no un ítem cortado", () => {
    expect(hayMasParaVer({ scrollTop: 396.5, clientHeight: 500, scrollHeight: 900 })).toBe(false);
    expect(hayMasParaVer({ scrollTop: 395, clientHeight: 500, scrollHeight: 900 })).toBe(true);
    expect(hayMasParaVer({ scrollTop: 395, clientHeight: 500, scrollHeight: 900 }, 10)).toBe(false);
  });
});
