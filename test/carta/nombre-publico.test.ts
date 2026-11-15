import { describe, expect, it } from "vitest";

import { LARGO_MAXIMO_NOMBRE_PUBLICO, validarNombrePublico } from "../../src/core/carta/nombre-publico";
import { CLAVES_PORTAL_V1, resolverEstiloPortal, validarValorPortal, validarValoresPortal } from "../../src/core/carta/portal";

/**
 * Nombre público de la empresa en la carta (F1 y F3 de `docs/diseno-nombre-publico-de-la-empresa-en-la-carta-2026-11-14.md`): qué se acepta al guardar y qué se lee del dato guardado. Los ejemplos usan «Empresa B».
 */
describe("validarNombrePublico (F3: lista de permitidos)", () => {
  it.each(["Empresa B", "Hotel Peñón & Cía.", "Café «Los Álamos»", "Ñandú 2000", "Empresa B 🍽️", "Mar+Sol", "100% Sur"])("acepta «%s»", (v) => {
    expect(validarNombrePublico(v)).toEqual({ ok: true, valor: v.normalize("NFC") });
  });

  it("recorta los espacios de los costados", () => {
    expect(validarNombrePublico("  Empresa B  ")).toEqual({ ok: true, valor: "Empresa B" });
  });

  it("guarda en NFC: «e» + acento combinante se vuelve «é»", () => {
    const r = validarNombrePublico("Café Sur");
    expect(r).toEqual({ ok: true, valor: "Café Sur" });
  });

  it.each([
    ["vacío", ""],
    ["solo espacios", "   "],
    ["salto de línea", "Empresa\nB"],
    ["tabulación", "Empresa\tB"],
    ["control (NUL)", "Empresa\u0000B"],
    ["ancho cero", "Empresa​B"],
    ["unidor de ancho cero", "Empresa‍B"],
    ["marca de dirección", "Empresa‮B"],
    ["separador de línea", "Empresa B"],
    ["menor que", "Empresa <B>"],
    ["mayor que", "Empresa > B"],
    ["no es texto (número)", 5],
    ["no es texto (null)", null],
    ["no es texto (objeto)", { a: 1 }],
  ])("rechaza %s", (_motivo, v) => {
    expect(validarNombrePublico(v).ok).toBe(false);
  });

  it("el largo: 60 pasa, 61 no", () => {
    expect(validarNombrePublico("a".repeat(LARGO_MAXIMO_NOMBRE_PUBLICO)).ok).toBe(true);
    const r = validarNombrePublico("a".repeat(LARGO_MAXIMO_NOMBRE_PUBLICO + 1));
    expect(r.ok).toBe(false);
  });
});

describe("la clave `portal_nombre_publico` del catálogo del portal", () => {
  it("está en la zona «Encabezado y títulos», nace vacía y es de texto", () => {
    const d = CLAVES_PORTAL_V1.find((c) => c.clave === "portal_nombre_publico");
    expect(d).toMatchObject({ zona: "Encabezado y títulos", defaultPortal: "", tipo: "texto", maximo: LARGO_MAXIMO_NOMBRE_PUBLICO });
  });

  it("al guardar: valida con la regla del nombre (rechaza <>), vacío = sin valor", () => {
    expect(validarValorPortal("portal_nombre_publico", "Empresa B")).toEqual({ ok: true, valor: "Empresa B" });
    expect(validarValorPortal("portal_nombre_publico", "  ")).toEqual({ ok: true, valor: null });
    expect(validarValorPortal("portal_nombre_publico", "Empresa <B>").ok).toBe(false);
    const todo = validarValoresPortal({ portal_nombre_publico: "Empresa <B>" });
    expect(todo.ok).toBe(false);
    if (!todo.ok) expect(todo.mensaje).toContain("Nombre público de la empresa");
  });

  it("al leer (F1): sin dato, con dato inválido o de otro tipo → vacío (neutro); el válido se lee tal cual", () => {
    expect(resolverEstiloPortal({}).valores.portal_nombre_publico).toBe("");
    expect(resolverEstiloPortal({ portal_nombre_publico: "Empresa B" }).valores.portal_nombre_publico).toBe("Empresa B");
    expect(resolverEstiloPortal({ portal_nombre_publico: "Empresa <B>" }).valores.portal_nombre_publico).toBe("");
    expect(resolverEstiloPortal({ portal_nombre_publico: "x​y" }).valores.portal_nombre_publico).toBe("");
    expect(resolverEstiloPortal({ portal_nombre_publico: "a".repeat(61) }).valores.portal_nombre_publico).toBe("");
    expect(resolverEstiloPortal({ portal_nombre_publico: 7 }).valores.portal_nombre_publico).toBe("");
    expect(resolverEstiloPortal(null).valores.portal_nombre_publico).toBe("");
  });

  it("al leer: un nombre guardado sin normalizar (NFD) se lee en NFC", () => {
    expect(resolverEstiloPortal({ portal_nombre_publico: "Café" }).valores.portal_nombre_publico).toBe("Café");
  });
});
