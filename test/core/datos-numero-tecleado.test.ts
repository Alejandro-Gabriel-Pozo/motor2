import { describe, expect, it } from "vitest";
import {
  CONTEXTO_IMPORTE,
  contextoDeCantidad,
  leerNumeroCanonico,
  mensajeDeNumeroRechazado,
  numeroDeEntrada,
  numeroDelCampo,
  pistaDeMiles,
  rechazoDeNumeroDeEntrada,
  textoCanonico,
  textoParaEscribir,
  tieneALoSumoDecimales,
} from "@/core/datos/numero-tecleado";

// Sin base de datos: todo es puro. El parser de lo que la persona escribe (con su contexto) se prueba en `datos-numero-tecleado-contexto.test.ts`; acá, lo que lo rodea.

describe("textoCanonico — dígitos, un solo punto decimal, sin notación exponencial", () => {
  it.each([
    [0, "0"],
    [5, "5"],
    [-5, "-5"],
    [1234.56, "1234.56"],
    [0.07, "0.07"],
    [1e21, "1000000000000000000000"],
    [1e-7, "0.0000001"],
    [-1.5e-7, "-0.00000015"],
    [1.5e22, "15000000000000000000000"],
  ])("%d → %j", (n, esperado) => {
    expect(textoCanonico(n)).toBe(esperado);
  });

  it("-0 → '0'", () => {
    expect(textoCanonico(-0)).toBe("0");
  });

  it.each([0, 1, -1, 0.07, 10.01, 1234.56, 1_000_000, 12345678.9, 1.2345, 0.0000001, 1e21, 999_999_999_999.99])(
    "ida y vuelta: leer el texto canónico de %d da el mismo número",
    (n) => {
      const r = leerNumeroCanonico(textoCanonico(n));
      expect(r.ok && r.valor).toBe(n);
    }
  );
});

describe("numeroDelCampo — lo que un formulario manda a la Server Action (lee el canal de valor, no lo tecleado)", () => {
  it("vacío → undefined", () => {
    expect(numeroDelCampo("")).toBeUndefined();
  });
  it("canónico → el número (el punto es SIEMPRE el decimal: «1.205» es 1,205)", () => {
    expect(numeroDelCampo("1234.56")).toBe(1234.56);
    expect(numeroDelCampo("1.205")).toBe(1.205);
    expect(numeroDelCampo("-3")).toBe(-3);
  });
  it("inválido, o escrito en notación tecleada, → NaN, nunca 0 ni un número adivinado", () => {
    for (const t of ["abc", "...,.,.,...", "1.000.000", "21,5", "  ", "1.205\u200B"]) expect(numeroDelCampo(t), JSON.stringify(t)).toBeNaN();
  });
});

describe("tieneALoSumoDecimales — sin falsos rechazos por ruido de punto flotante", () => {
  it.each([
    [0.07, 2],
    [10.01, 2],
    [19.17, 2],
    [23.33, 2],
    [1.2345, 4],
    [3, 0],
    [1.25, 2],
    [-10.01, 2],
    [999_999_999_999.99, 2],
  ])("%d tiene a lo sumo %d decimales", (n, d) => {
    expect(tieneALoSumoDecimales(n, d)).toBe(true);
  });

  it.each([
    [1.005, 2],
    [12.345, 2],
    [2.5, 0],
    [1.255, 2],
    [1.23456, 4],
  ])("%d tiene más de %d decimales", (n, d) => {
    expect(tieneALoSumoDecimales(n, d)).toBe(false);
  });
});


describe("textoParaEscribir — el número como se escribe para editarlo", () => {
  it.each([
    [1.205, "1,205"],
    [21000, "21000"],
    [0.5, "0,5"],
    [-3.25, "-3,25"],
    [0, "0"],
    [1e-7, "0,0000001"],
  ])("%d → %j", (n, esperado) => {
    expect(textoParaEscribir(n)).toBe(esperado);
  });
});

describe("numeroDeEntrada — el servidor lee un texto con el MISMO contexto que la pantalla (nunca confía en el cliente)", () => {
  it("un número va tal cual; null o undefined son «sin valor»; cualquier otra cosa es error de formato", () => {
    expect(numeroDeEntrada(5, CONTEXTO_IMPORTE)).toEqual({ ok: true, valor: 5 });
    expect(numeroDeEntrada(-0, CONTEXTO_IMPORTE)).toEqual({ ok: true, valor: 0 });
    expect(numeroDeEntrada(null, CONTEXTO_IMPORTE)).toEqual({ ok: true, valor: null });
    expect(numeroDeEntrada(undefined, CONTEXTO_IMPORTE)).toEqual({ ok: true, valor: null });
    for (const raro of [Number.NaN, Infinity, true, {}, [], "abc"]) expect(numeroDeEntrada(raro, CONTEXTO_IMPORTE).ok, String(raro)).toBe(false);
  });

  it("un texto «21.000»: veintiún mil en un importe (el servidor ya no lo lee como 21) y ambiguo en una cantidad de 3 decimales", () => {
    expect(numeroDeEntrada("21.000", CONTEXTO_IMPORTE)).toEqual({ ok: true, valor: 21000 });
    expect(numeroDeEntrada("21.000", contextoDeCantidad(3))).toMatchObject({ ok: false, codigo: "ambiguo" });
    expect(numeroDeEntrada("21,000", CONTEXTO_IMPORTE)).toMatchObject({ ok: false, codigo: "decimales" });
  });
});

describe("mensajes de un número que no se pudo leer", () => {
  it("con sujeto: «no es un número válido», el ambiguo con sus dos lecturas y los decimales con el sujeto adelante; sin sujeto, el del parser", () => {
    expect(mensajeDeNumeroRechazado({ codigo: "formato", mensaje: "No es un número válido." }, "El precio")).toBe("El precio no es un número válido.");
    expect(mensajeDeNumeroRechazado({ codigo: "ambiguo", mensaje: "¿1,205 o 1205? Escribí 1205 o 1,205." }, "El factor")).toBe("El factor: ¿1,205 o 1205? Escribí 1205 o 1,205.");
    expect(mensajeDeNumeroRechazado({ codigo: "decimales", mensaje: "Admite como máximo 2 decimales." }, "El precio")).toBe("El precio admite como máximo 2 decimales.");
    expect(mensajeDeNumeroRechazado({ codigo: "decimales", mensaje: "Admite como máximo 2 decimales." })).toBe("Admite como máximo 2 decimales.");
  });

  it("pistaDeMiles: solo para «a,bbb» con a de 1 a 3 cifras sin cero inicial", () => {
    expect(pistaDeMiles("21,000")).toBe("Para 21000 escribí 21000 o 21.000,00.");
    expect(pistaDeMiles(" -1,205 ")).toBe("Para 1205 escribí 1205 o 1.205,00.");
    for (const t of ["21,00", "0,125", "1.234,567", "1234,567", "21.000", "abc", 21, null]) expect(pistaDeMiles(t), String(t)).toBeNull();
  });

  it("rechazoDeNumeroDeEntrada: los decimales llevan el mensaje del validador (y la pista); lo demás, el del parser con sujeto", () => {
    const decimales = { codigo: "decimales", mensaje: "x" };
    expect(rechazoDeNumeroDeEntrada(decimales, "El precio", "El precio admite como máximo 2 decimales.", "21,000")).toEqual({
      ok: false,
      codigo: "decimales",
      mensaje: "El precio admite como máximo 2 decimales. Para 21000 escribí 21000 o 21.000,00.",
    });
    expect(rechazoDeNumeroDeEntrada(decimales, "El precio", "El precio admite como máximo 2 decimales.", "0,555")).toMatchObject({ mensaje: "El precio admite como máximo 2 decimales." });
    expect(rechazoDeNumeroDeEntrada({ codigo: "formato", mensaje: "No es un número válido." }, "El precio", "x", "abc")).toEqual({ ok: false, codigo: "formato", mensaje: "El precio no es un número válido." });
  });
});
