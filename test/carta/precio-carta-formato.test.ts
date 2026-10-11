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

/**
 * U8 (auditoría de abstracciones 2026-10-11): el precio de una promo con más de 2 decimales se RECHAZA, no se redondea en silencio (la política de la entrada de
 * importes es `validarImporte`: «Redondeo uniforme» para la entrada = rechazar). Antes 10,555 se guardaba como 10,56 sin avisar. El parseo (`Number(...)`, sin coma) no se toca.
 */
describe("U8: precio de carta con más de 2 decimales", () => {
  const MENSAJE_DECIMALES = "El precio admite como máximo 2 decimales (por ejemplo, 10.55).";

  it("más de 2 decimales se rechaza con un mensaje claro, en número y en texto", () => {
    expect(validarPrecioCarta(10.555)).toEqual({ ok: false, mensaje: MENSAJE_DECIMALES });
    expect(validarPrecioCarta("10.555")).toEqual({ ok: false, mensaje: MENSAJE_DECIMALES });
    expect(validarPrecioCarta(10.005)).toEqual({ ok: false, mensaje: MENSAJE_DECIMALES });
    expect(validarPrecioCarta("0.001")).toEqual({ ok: false, mensaje: MENSAJE_DECIMALES });
  });

  it("hasta 2 decimales pasa tal cual, incluido el 0 adrede", () => {
    expect(validarPrecioCarta(10.5)).toEqual({ ok: true, valor: 10.5 });
    expect(validarPrecioCarta("10.55")).toEqual({ ok: true, valor: 10.55 });
    expect(validarPrecioCarta(0.07)).toEqual({ ok: true, valor: 0.07 });
    expect(validarPrecioCarta(0)).toEqual({ ok: true, valor: 0 });
    expect(validarPrecioCarta("25000")).toEqual({ ok: true, valor: 25000 });
  });

  it("los demás rechazos conservan su mensaje y su prioridad (negativo, tope, NaN, vacío)", () => {
    expect(validarPrecioCarta(-10.555)).toEqual({ ok: false, mensaje: "El precio no puede ser negativo." });
    expect(validarPrecioCarta(1e12)).toEqual({ ok: false, mensaje: "El precio no es un número válido." });
    expect(validarPrecioCarta(Number.NaN).ok).toBe(false);
    expect(validarPrecioCarta(null)).toEqual({ ok: false, mensaje: "Falta el precio." });
    expect(validarPrecioCarta("")).toEqual({ ok: false, mensaje: "Falta el precio." });
  });
});
