import { beforeEach, describe, expect, it, vi } from "vitest";

// `refresh` de next/cache tira si no se llama desde un Server Action real. Acá se simula lo que hace, con y sin el código del error.
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ refresh }));

import { refrescarVistaSiHaceFalta } from "../../src/server/actions/refrescar";

/**
 * `refrescarVistaSiHaceFalta` traga UN error a propósito: el E870 ("refresh can only be called from within a Server Action"), que es lo que pasa
 * cuando Vitest llama a una acción directo desde Node, sin el contexto real de Next. Sin ese catch, los cientos de tests que llaman a
 * acciones que refrescan explotarían. Pero tiene que ser ANGOSTO: si tragara cualquier error, un fallo real de `refresh()` pasaría en silencio.
 * Este archivo fija las dos mitades. (Hasta ahora ningún test tocaba este helper.)
 */
function errorDeNext(codigo?: string) {
  const e = new Error("refresh can only be called from within a Server Action") as Error & { __NEXT_ERROR_CODE?: string };
  if (codigo) e.__NEXT_ERROR_CODE = codigo;
  return e;
}

describe("refrescarVistaSiHaceFalta", () => {
  // Con llaves a propósito: si el callback DEVOLVIERA el mock, Vitest lo ejecutaría como función de limpieza al terminar cada test.
  beforeEach(() => {
    refresh.mockReset();
  });

  it("pide el refresco una sola vez cuando refresh() anda", () => {
    refrescarVistaSiHaceFalta();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("fuera de un Server Action real (E870) no lanza: es el caso de Vitest llamando a una acción directo", () => {
    refresh.mockImplementation(() => {
      throw errorDeNext("E870");
    });
    expect(() => refrescarVistaSiHaceFalta()).not.toThrow();
  });

  it("un error de Next con OTRO código sigue de largo (el catch es angosto)", () => {
    const otro = errorDeNext("E872");
    refresh.mockImplementation(() => {
      throw otro;
    });
    expect(() => refrescarVistaSiHaceFalta()).toThrow(otro);
  });

  it("un error sin código sigue de largo", () => {
    const sinCodigo = errorDeNext();
    refresh.mockImplementation(() => {
      throw sinCodigo;
    });
    expect(() => refrescarVistaSiHaceFalta()).toThrow(sinCodigo);
  });

  it("algo que ni siquiera es un Error sigue de largo", () => {
    refresh.mockImplementation(() => {
      throw "no soy un Error";
    });
    expect(() => refrescarVistaSiHaceFalta()).toThrow("no soy un Error");
  });
});
