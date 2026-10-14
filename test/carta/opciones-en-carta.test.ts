import { describe, expect, it } from "vitest";
import { opcionesParaLaCarta, type ResumenDePreciosParaCarta } from "../../src/core/carta/opciones-en-carta";

/**
 * GO-2d: cómo se ven en la carta las opciones de un producto (puro). Un tamaño con su precio final; un recargo solo si suma o resta algo; la «ninguna» de un adicional no se muestra;
 * un grupo sin nada para mostrar no sale; un producto que hoy no se puede pedir, tampoco (null). Lo agotado ya llega afuera (lo saca `resumenDePrecios`, probado en test/pos).
 */
const resumen = (extra: Partial<ResumenDePreciosParaCarta> = {}): ResumenDePreciosParaCarta => ({
  grupos: [
    { nombre: "Tamaño", tipo: "MEDIDA", cantidadMinima: 1, cantidadMaxima: 1, opciones: [{ nombre: "Chico", esNinguna: false, precioFinal: 2200, diferencia: -300 }, { nombre: "Sin precio", esNinguna: false, precioFinal: null, diferencia: 0 }] },
    { nombre: "Guarnición", tipo: "INCLUIDA", cantidadMinima: 1, cantidadMaxima: 1, opciones: [{ nombre: "Puré", esNinguna: false, precioFinal: null, diferencia: 0 }, { nombre: "Sin guarnición", esNinguna: true, precioFinal: null, diferencia: 0 }] },
    { nombre: "Extras", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2, opciones: [{ nombre: "Sin extras", esNinguna: true, precioFinal: null, diferencia: 0 }, { nombre: "Huevo", esNinguna: false, precioFinal: null, diferencia: 600 }] },
    { nombre: "Vacío", tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 1, opciones: [{ nombre: "Ninguno", esNinguna: true, precioFinal: null, diferencia: 0 }] },
  ],
  desde: 2200,
  hayVariacion: true,
  vendible: true,
  ...extra,
});

describe("opcionesParaLaCarta", () => {
  it("tamaño con precio final, incluida sin recargo (también la «ninguna»), adicional con su recargo; sin la «ninguna» del adicional ni grupos vacíos", () => {
    expect(opcionesParaLaCarta(resumen())).toEqual({
      grupos: [
        { nombre: "Tamaño", obligatorio: true, maximo: 1, opciones: [{ nombre: "Chico", precio: 2200 }] },
        { nombre: "Guarnición", obligatorio: true, maximo: 1, opciones: [{ nombre: "Puré" }, { nombre: "Sin guarnición" }] },
        { nombre: "Extras", obligatorio: false, maximo: 2, opciones: [{ nombre: "Huevo", recargo: 600 }] },
      ],
      desde: 2200,
      hayVariacion: true,
    });
  });

  it("un producto que hoy no se puede pedir no sale en la carta", () => {
    expect(opcionesParaLaCarta(resumen({ vendible: false, desde: null }))).toBeNull();
    expect(opcionesParaLaCarta(resumen({ desde: null }))).toBeNull();
  });
});
