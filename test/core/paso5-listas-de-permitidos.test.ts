import { describe, expect, it, vi } from "vitest";
import { enviarConEnviador } from "../../src/core/correo/enviar";
import type { EnviadorDeCorreo, MensajeDeCorreo } from "../../src/core/correo/tipos";
import { rutaInternaSegura } from "../../src/core/navegacion/volver";
import { claveDeConfiguracion } from "../../src/core/pos/promo-combo";

/**
 * Oráculo del paso 5 de la auditoría 2026-11-12 («todo nace cerrado», AGENTS.md 2026-11-11): tres validaciones que estaban escritas por lista de prohibidos pasan a declarar lo PERMITIDO y se
 * comprueba que aceptan lo mismo de siempre y rechazan lo que antes pasaba de casualidad. (La clave de Resend de `src/env.ts` pasó de `re_\S+` a `re_` + letras, números y guion bajo: es la
 * forma documentada de esas claves; esa validación corre al arrancar la aplicación y no se prueba acá.)
 */
describe("identificador de una opción en la configuración fija de una promo (`claveDeConfiguracion`)", () => {
  it("acepta identificadores de la base (cuid), con guion y guion bajo, y arma el canónico estable ordenado", () => {
    expect(claveDeConfiguracion([{ opcionId: "cmwdneje80049l71z00xcyq3l", cantidad: 1 }])).toBe("cmwdneje80049l71z00xcyq3l=1");
    expect(claveDeConfiguracion([{ opcionId: "b_2", cantidad: 2 }, { opcionId: "a-1", cantidad: 1 }])).toBe("a-1=1;b_2=2");
    expect(claveDeConfiguracion([])).toBe("");
  });

  const rechazados: Array<[string, string]> = [
    ["punto y coma (separa pares)", "a;b"],
    ["signo igual (separa id y cantidad)", "a=1"],
    ["espacio", "a b"],
    ["salto de línea", "a\nb"],
    ["letra no ASCII", "añ"],
    ["carácter de ancho cero", "a​b"],
    ["vacío", ""],
    ["65 caracteres", "a".repeat(65)],
  ];
  it.each(rechazados)("rechaza un identificador con %s", (_motivo, opcionId) => {
    expect(claveDeConfiguracion([{ opcionId, cantidad: 1 }])).toBeNull();
  });

  it("acepta 64 caracteres y rechaza una opción repetida", () => {
    expect(claveDeConfiguracion([{ opcionId: "a".repeat(64), cantidad: 1 }])).toBe(`${"a".repeat(64)}=1`);
    expect(claveDeConfiguracion([{ opcionId: "a", cantidad: 1 }, { opcionId: "a", cantidad: 2 }])).toBeNull();
  });
});

describe("asunto y clave de idempotencia de un correo (`enviarConEnviador`)", () => {
  const mensaje = (cambios: Partial<MensajeDeCorreo> = {}): MensajeDeCorreo => ({ para: ["ana@ejemplo.com"], asunto: "Tu código de ingreso", texto: "Hola", ...cambios });
  const intentar = async (m: MensajeDeCorreo) => {
    const enviar = vi.fn(async () => ({ ok: true as const, idExterno: null }));
    const enviador = { enviar } as unknown as EnviadorDeCorreo;
    const r = await enviarConEnviador("avisos", enviador, m);
    return { r, mandados: enviar.mock.calls.length };
  };

  it("manda un asunto con acentos, símbolos, emoji y espacios de no separación", async () => {
    for (const asunto of ["Tu código de ingreso", "Confirmación ✔ #123 — ¡Hola!", "Mesa 5 🍕"]) {
      expect((await intentar(mensaje({ asunto }))).mandados, asunto).toBe(1);
    }
  });

  it("rechaza, sin mandar nada, un asunto con salto de línea (inyección de encabezado), tabulación, NUL, dirección de texto o ancho cero", async () => {
    for (const asunto of ["Hola\nBcc: otro@x.com", "Hola\r\nBcc: otro@x.com", "Hola\tmundo", "Ho\u0000la", "Hola ‮atsiv", "Ho​la", ""]) {
      const { r, mandados } = await intentar(mensaje({ asunto }));
      expect(mandados, JSON.stringify(asunto)).toBe(0);
      expect(r).toMatchObject({ ok: false, motivo: "DEFINITIVO" });
    }
  });

  it("la clave de idempotencia: un UUID pasa; con salto de línea o espacio de ancho cero, no", async () => {
    expect((await intentar(mensaje({ claveDeIdempotencia: "0f8fad5b-d9cb-469f-a165-70867728950e" }))).mandados).toBe(1);
    expect((await intentar(mensaje({ claveDeIdempotencia: "a\nb" }))).mandados).toBe(0);
    expect((await intentar(mensaje({ claveDeIdempotencia: "a​b" }))).mandados).toBe(0);
  });
});

describe("ruta interna segura para volver (`rutaInternaSegura`): solo ASCII visible, sin barra invertida", () => {
  it("acepta rutas del sitio con consulta", () => {
    expect(rutaInternaSegura("/carta?x=1&y=a%20b")).toBe("/carta?x=1&y=a%20b");
    expect(rutaInternaSegura("/catalogo/productos/abc#parte")).not.toBeNull();
  });

  it("rechaza lo que se sale del sitio o rompe el encabezado", () => {
    for (const ruta of ["//sitio.com", "/\\sitio.com", "https://sitio.com", "carta", "/a b", "/a\tb", "/a\nb", "/á", "/a​b", "/a\\b", "", "/\u0000"]) {
      expect(rutaInternaSegura(ruta), JSON.stringify(ruta)).toBeNull();
    }
    expect(rutaInternaSegura(null)).toBeNull();
    expect(rutaInternaSegura(`/${"a".repeat(600)}`)).toBeNull();
  });
});
