import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA, leerOpcionEnCarta } from "../../src/core/opciones/public";

/** Fase 4 de la ola «precio y carta» (ADR-035, DEC-34): cómo lee la carta una opción con «se lee en la carta como». */
describe("leerOpcionEnCarta", () => {
  const op = (nombre: string, esNinguna = false) => ({ nombre, esNinguna });

  it("con prefijo: prefijo + la opción con la primera letra en minúscula", () => {
    expect(leerOpcionEnCarta("De", op("Carne"))).toBe("De carne");
    expect(leerOpcionEnCarta("De", op("Pollo"))).toBe("De pollo");
    expect(leerOpcionEnCarta("Con", op("Salsa de tomate"))).toBe("Con salsa de tomate");
  });

  it("la primera letra Unicode con es-AR (tildes, eñe), sin excepción para siglas ni nombres propios", () => {
    expect(leerOpcionEnCarta("De", op("Ñandú"))).toBe("De ñandú");
    expect(leerOpcionEnCarta("De", op("Ángus"))).toBe("De ángus");
    expect(leerOpcionEnCarta("Con", op("BBQ"))).toBe("Con bBQ");
    expect(leerOpcionEnCarta("De", op("Angus"))).toBe("De angus");
    expect(leerOpcionEnCarta("Con", op("3 quesos"))).toBe("Con 3 quesos");
    expect(leerOpcionEnCarta("Con", op("🥑 palta"))).toBe("Con 🥑 palta");
  });

  it("sin prefijo (null o vacío), la opción tal cual; la «ninguna», siempre tal cual", () => {
    expect(leerOpcionEnCarta(null, op("Pizza muzzarella"))).toBe("Pizza muzzarella");
    expect(leerOpcionEnCarta("", op("Pizza muzzarella"))).toBe("Pizza muzzarella");
    expect(leerOpcionEnCarta("Con", op("Sin nada", true))).toBe("Sin nada");
  });

  it("el tope es el del CHECK de la base: 20", () => {
    expect(LARGO_MAXIMO_DEL_PREFIJO_EN_CARTA).toBe(20);
  });
});
