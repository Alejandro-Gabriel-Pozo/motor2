import { describe, expect, it } from "vitest";
import { diasAtrasDeUrl, MAXIMO_DIAS_ATRAS } from "../../src/core/reportes/dias-atras";

describe("diasAtrasDeUrl: los días atrás de la URL son un entero acotado o el valor por defecto", () => {
  it("un entero válido se respeta", () => {
    expect(diasAtrasDeUrl("45", 30)).toBe(45);
    expect(diasAtrasDeUrl("1", 30)).toBe(1);
  });

  it("falta, vacío, cero, negativo, decimal, texto o lista → el valor por defecto", () => {
    for (const malo of [undefined, "", "  ", "0", "-5", "1.5", "abc", "NaN", "Infinity", ["10", "20"], 10]) {
      expect(diasAtrasDeUrl(malo, 7), String(malo)).toBe(7);
    }
  });

  it("un número descomunal se acota al máximo (no genera una fecha inválida)", () => {
    expect(diasAtrasDeUrl("99999999999", 30)).toBe(MAXIMO_DIAS_ATRAS);
    expect(diasAtrasDeUrl(String(MAXIMO_DIAS_ATRAS + 1), 30)).toBe(MAXIMO_DIAS_ATRAS);
    const desde = new Date();
    desde.setUTCDate(desde.getUTCDate() - diasAtrasDeUrl("99999999999", 30));
    expect(Number.isNaN(desde.getTime())).toBe(false);
  });
});
