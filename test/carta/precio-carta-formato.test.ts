import { describe, expect, it } from "vitest";
import { validarPrecioCarta } from "../../src/core/carta/validaciones";

/**
 * O.43 (Hito 4, bloque D; aprobado por el dueño): el precio de una promo de la carta (`validarPrecioCarta`, lo usan el guard de `guardarPromoCarta` y el caso de
 * uso del precio local de la promo) parsea con `Number(...)`, que NO acepta la coma decimal. Criterio conservador decidido por el orquestador: la coma SIGUE sin
 * aceptarse (el parseo no se toca); lo que cambia es el mensaje, que antes decía «El precio no puede ser negativo.» para «12,5» (un `NaN` caía en `!(n >= 0)`) y
 * ahora dice que el formato no es válido y que se use el punto. Un negativo de verdad conserva su mensaje.
 */
describe("O.43: precio de carta con coma (o sin forma de número)", () => {
  const MENSAJE_FORMATO = "El precio no tiene un formato válido: usá el punto como separador decimal (por ejemplo, 12.5).";

  it("«12,5» se sigue rechazando, con el mensaje de formato (no el de negativo)", () => {
    expect(validarPrecioCarta("12,5")).toEqual({ ok: false, mensaje: MENSAJE_FORMATO });
    expect(validarPrecioCarta("abc")).toEqual({ ok: false, mensaje: MENSAJE_FORMATO });
  });

  it("lo que se aceptaba se sigue aceptando y un negativo sigue diciendo negativo", () => {
    expect(validarPrecioCarta("12.5")).toEqual({ ok: true, valor: 12.5 });
    expect(validarPrecioCarta(-1)).toEqual({ ok: false, mensaje: "El precio no puede ser negativo." });
    expect(validarPrecioCarta("")).toEqual({ ok: false, mensaje: "Falta el precio." });
    expect(validarPrecioCarta(Infinity)).toEqual({ ok: false, mensaje: "El precio no es un número válido." });
  });
});
