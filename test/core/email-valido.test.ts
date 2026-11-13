import { describe, expect, it } from "vitest";
import { esEmailValido } from "../../src/core/datos/email";
import { validarEmailOpcional } from "../../src/core/datos/limites";
import { esDireccionValida, esRemitenteValido } from "../../src/core/correo/direcciones";
import { validarAltaDeAdmin } from "../../src/core/plataforma/primer-admin";

/**
 * Oráculo del validador único de correo (paso 3 de la auditoría 2026-11-12; «todo nace cerrado»): una lista de PERMITIDOS, igual para el alta de proveedor, la de un administrador de la consola y el
 * remitente de los correos. Antes cada una tenía su criterio por prohibición («cualquier cosa menos espacios y @»).
 */
describe("esEmailValido: lo que se permite", () => {
  const validos = ["ana@ejemplo.com", "ana.perez@sub.ejemplo.com.ar", "a@b.co", "ana+pedidos@ejemplo.com", "o'brien@ejemplo.com", "ANA@EJEMPLO.COM", "a_b-c@x-y.io", "ana@xn--aadir-9ta.com", "1234@5678.ar", "a{b}@ejemplo.com"];
  it.each(validos)("acepta %s", (v) => expect(esEmailValido(v)).toBe(true));

  const invalidos: Array<[string, string]> = [
    ["sin arroba", "ana.ejemplo.com"],
    ["dos arrobas", "ana@@ejemplo.com"],
    ["dos arrobas separadas", "ana@b@ejemplo.com"],
    ["sin parte local", "@ejemplo.com"],
    ["sin dominio", "ana@"],
    ["dominio sin punto", "ana@localhost"],
    ["dominio que termina en punto", "ana@ejemplo.com."],
    ["etiqueta vacía en el dominio", "ana@ejemplo..com"],
    ["etiqueta que empieza con guion", "ana@-ejemplo.com"],
    ["etiqueta que termina con guion", "ana@ejemplo-.com"],
    ["punto al principio de la parte local", ".ana@ejemplo.com"],
    ["punto al final de la parte local", "ana.@ejemplo.com"],
    ["dos puntos seguidos en la parte local", "an..a@ejemplo.com"],
    ["espacio", "ana @ejemplo.com"],
    ["tabulación", "ana\t@ejemplo.com"],
    ["salto de línea (inyección de encabezado)", "ana@ejemplo.com\nBcc: otro@x.com"],
    ["segundo destinatario con coma", "ana@ejemplo.com,otro@ejemplo.com"],
    ["segundo destinatario con punto y coma", "ana@ejemplo.com;otro@ejemplo.com"],
    ["comillas dobles", '"ana"@ejemplo.com'],
    ["con nombre y signos de mayor y menor", "Ana <ana@ejemplo.com>"],
    ["paréntesis (comentario)", "ana(comentario)@ejemplo.com"],
    ["corchetes (dominio literal)", "ana@[127.0.0.1]"],
    ["barra invertida", "ana\\@ejemplo.com"],
    ["letra con tilde en la parte local", "añ@ejemplo.com"],
    ["dominio con letras no ASCII (va en punycode)", "ana@añadir.com"],
    ["carácter de ancho cero", "ana​@ejemplo.com"],
    ["NUL", "ana\u0000@ejemplo.com"],
    ["vacío", ""],
  ];
  it.each(invalidos)("rechaza %s", (_motivo, v) => expect(esEmailValido(v)).toBe(false));

  it("respeta los largos: parte local de 64, etiqueta de 63 y dirección de 254", () => {
    expect(esEmailValido(`${"a".repeat(64)}@ejemplo.com`)).toBe(true);
    expect(esEmailValido(`${"a".repeat(65)}@ejemplo.com`)).toBe(false);
    expect(esEmailValido(`ana@${"b".repeat(63)}.com`)).toBe(true);
    expect(esEmailValido(`ana@${"b".repeat(64)}.com`)).toBe(false);
    const base = `a@${`${"b".repeat(60)}.`.repeat(4)}`; // 246 caracteres
    const de254 = `${base}${"c".repeat(5)}.uy`;
    expect(de254).toHaveLength(254);
    expect(esEmailValido(de254)).toBe(true);
    expect(esEmailValido(`${base}${"c".repeat(6)}.uy`)).toBe(false); // 255
  });
});

describe("los tres lugares usan el mismo criterio", () => {
  it("proveedor y demás emails opcionales: vacío es «sin email»; lo inválido se rechaza", () => {
    expect(validarEmailOpcional("")).toMatchObject({ ok: true, valor: null });
    expect(validarEmailOpcional("  ana@ejemplo.com ")).toMatchObject({ ok: true, valor: "ana@ejemplo.com" });
    expect(validarEmailOpcional("ana@ejemplo.com,otro@ejemplo.com").ok).toBe(false);
    expect(validarEmailOpcional("ana@localhost").ok).toBe(false);
  });

  it("administrador de la consola: el mismo criterio, con el mensaje de siempre", () => {
    expect(validarAltaDeAdmin({ email: "Ana@Ejemplo.com", nombre: " Ana " })).toEqual({ email: "ana@ejemplo.com", nombre: "Ana" });
    expect(() => validarAltaDeAdmin({ email: "ana@ejemplo.com\nBcc: x@y.com", nombre: "Ana" })).toThrow("El email no es válido.");
    expect(() => validarAltaDeAdmin({ email: "ana@@ejemplo.com", nombre: "Ana" })).toThrow("El email no es válido.");
  });

  it("remitente de los correos: dirección sola o «Nombre <dirección>»; nada con dos destinatarios", () => {
    expect(esDireccionValida("ana@ejemplo.com")).toBe(true);
    expect(esDireccionValida("ana@ejemplo.com,otro@ejemplo.com")).toBe(false);
    expect(esRemitenteValido("Motor 2 <avisos@ejemplo.com>")).toBe(true);
    expect(esRemitenteValido("avisos@ejemplo.com")).toBe(true);
    expect(esRemitenteValido("Motor 2 <avisos@ejemplo.com>, Otro <otro@ejemplo.com>")).toBe(false);
  });
});
