import { describe, expect, it } from "vitest";
import { diasAtrasDeUrl, MAXIMO_DIAS_ATRAS } from "../../src/core/reportes/dias-atras";
import { MAXIMO_DE_DIAS_DE_UN_RANGO } from "../../src/core/reportes/rango-por-defecto";

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

  it("S-28: el máximo es el mismo tope de un rango de reporte (366 días), no 10 años de historia: ?dias=3650 recorría todo el Kardex", () => {
    expect(MAXIMO_DIAS_ATRAS).toBe(MAXIMO_DE_DIAS_DE_UN_RANGO);
    expect(diasAtrasDeUrl("3650", 30)).toBe(366);
    expect(diasAtrasDeUrl("367", 30)).toBe(366);
    expect(diasAtrasDeUrl("366", 30)).toBe(366);
    expect(diasAtrasDeUrl("365", 30)).toBe(365);
  });
});
