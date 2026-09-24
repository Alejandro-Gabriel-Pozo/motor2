import { describe, expect, it } from "vitest";
import {
  parsearLongitudCss,
  validarAltoBanda,
  validarAnchoImagenMobile,
  validarEnum,
  validarOpacidad,
  validarPorcentaje,
  validarRedSocial,
  validarTamanoFondo,
  validarTamanoFuente,
  validarTelefono,
  validarUrlHttps,
  valorCssSeguro,
} from "../../src/core/carta/css-valores";

/**
 * Validadores de tipografía, layout y contacto del tema de la carta (docs/plan-tema-carta-2026-09-24.md, M2, D13). Lo central es
 * que nada que pueda cerrar una regla CSS o un `<style>` pase: el alto de banda en desktop se inyecta crudo dentro de un `<style>`
 * en la carta pública, y los demás van a `style` en línea o a un `href`.
 */

const valor = <T>(r: { ok: true; valor: T } | { ok: false; mensaje: string }) => (r.ok ? r.valor : `ERROR: ${r.mensaje}`);

describe("valorCssSeguro: el filtro de caracteres", () => {
  it("recorta y pasa a minúsculas", () => {
    expect(valorCssSeguro("  0.9REM ")).toBe("0.9rem");
  });

  it.each([";", "{", "}", "<", ">", '"', "'", "\\", "/", "*", ":", "!", "@", "#", "=", "a\nb", "ñ", "１２px"])("deja afuera %j", (c) => {
    expect(valorCssSeguro(`12px${c}`)).toBeNull();
  });

  it("hasta 80 caracteres", () => {
    expect(valorCssSeguro("1".repeat(80))).toBe("1".repeat(80));
    expect(valorCssSeguro("1".repeat(81))).toBeNull();
  });
});

describe("parsearLongitudCss y validarTamanoFuente", () => {
  const ACEPTADOS = [
    "14",
    "0.88rem",
    "12px",
    "18vh",
    "clamp(80px, 18vh, 140px)",
    "clamp(2.25rem, 4vw + 1.5rem, 3.75rem)",
    "min(10vw, 40px)",
    "max(1rem, 2vw, 10px, 3em)",
    "calc(100% - 2rem)",
    "clamp( 1.7rem , 7vw,2.1rem )",
    ".5rem",
    "10dvh",
  ];
  it.each(ACEPTADOS)("acepta %j", (v) => {
    expect(validarTamanoFuente(v)).toEqual({ ok: true, valor: v.toLowerCase() });
  });

  const RECHAZADOS = [
    "90px}body{display:none",
    "90px;x:y",
    "</style>",
    "expression(1)",
    "url(x)",
    "var(--x)",
    "clamp(clamp(1px,2px,3px),1px,2px)",
    "4vw+1rem",
    "calc(4vw+1rem)",
    "-5px",
    "1e3px",
    "12pt",
    "１２px",
    `clamp(${"1".repeat(70)}px, 1px, 2px)`,
    "clamp(1px, 2px)",
    "min(1px)",
    "max(1px, 2px, 3px, 4px, 5px)",
    "calc(1px, 2px)",
    "",
    "px",
    "10001px",
    "auto",
  ];
  it.each(RECHAZADOS)("rechaza %j", (v) => {
    expect(validarTamanoFuente(v).ok).toBe(false);
  });

  it("un valor de 81 caracteres se rechaza aunque la gramática lo aceptara", () => {
    const largo = `calc(${Array(13).fill("1px").join(" + ")})`; // 81 caracteres
    expect(largo).toHaveLength(81);
    expect(validarTamanoFuente(largo).ok).toBe(false);
    expect(validarTamanoFuente(largo.replace("calc(1px + ", "calc(")).ok).toBe(true);
  });

  it("número solo: entre 4 y 200 (la carta le agrega px con normFuente)", () => {
    expect(validarTamanoFuente("4")).toEqual({ ok: true, valor: "4" });
    expect(validarTamanoFuente("200")).toEqual({ ok: true, valor: "200" });
    expect(validarTamanoFuente("3").ok).toBe(false);
    expect(validarTamanoFuente("201").ok).toBe(false);
  });

  it("sin funciones, solo una longitud", () => {
    expect(parsearLongitudCss("12px", { funciones: false })).toEqual({ ok: true, valor: "12px" });
    expect(parsearLongitudCss("0", { funciones: false })).toEqual({ ok: true, valor: "0" });
    expect(parsearLongitudCss("min(1px, 2px)", { funciones: false }).ok).toBe(false);
    expect(parsearLongitudCss("12", { funciones: false }).ok).toBe(false);
  });
});

describe("alto de banda", () => {
  it("desktop: un número solo se guarda como <n>px (va crudo dentro de un <style>)", () => {
    expect(validarAltoBanda("120", { normalizarPx: true })).toEqual({ ok: true, valor: "120px" });
    expect(validarAltoBanda("clamp(80px, 18vh, 140px)", { normalizarPx: true })).toEqual({ ok: true, valor: "clamp(80px, 18vh, 140px)" });
    expect(validarAltoBanda("90px}body{display:none", { normalizarPx: true }).ok).toBe(false);
    expect(validarAltoBanda("1px}*{x:y", { normalizarPx: true }).ok).toBe(false);
  });

  it("mobile: el número solo queda tal cual (la carta le agrega px); rango 20-600", () => {
    expect(validarAltoBanda("90", { normalizarPx: false })).toEqual({ ok: true, valor: "90" });
    expect(validarAltoBanda("19", { normalizarPx: false }).ok).toBe(false);
    expect(validarAltoBanda("601", { normalizarPx: false }).ok).toBe(false);
    expect(validarAltoBanda("12vh", { normalizarPx: false })).toEqual({ ok: true, valor: "12vh" });
  });
});

describe("imagen de sección", () => {
  it("ancho mobile: número 1-400 o una longitud, sin funciones", () => {
    expect(valor(validarAnchoImagenMobile("160"))).toBe("160");
    expect(valor(validarAnchoImagenMobile("80px"))).toBe("80px");
    expect(validarAnchoImagenMobile("0").ok).toBe(false);
    expect(validarAnchoImagenMobile("401").ok).toBe(false);
    expect(validarAnchoImagenMobile("clamp(1px, 2px, 3px)").ok).toBe(false);
  });

  it("tamaño de fondo: contain/cover/auto o 1-2 tokens auto|longitud", () => {
    for (const v of ["auto 100%", "contain", "cover", "auto", "50%", "100px auto", "Contain"]) expect(validarTamanoFondo(v)).toEqual({ ok: true, valor: v.toLowerCase() });
    for (const v of ["auto auto auto", "100", "contain cover", "url(x)", "auto;x:y", "min(1px, 2px)"]) expect(validarTamanoFondo(v).ok).toBe(false);
  });

  it("porcentaje: 0-100, hasta 2 decimales, sin %", () => {
    expect(valor(validarPorcentaje("50"))).toBe("50");
    expect(valor(validarPorcentaje("0"))).toBe("0");
    expect(valor(validarPorcentaje("12.25"))).toBe("12.25");
    expect(valor(validarPorcentaje("50.0"))).toBe("50");
    for (const v of ["101", "50%", "-1", "1.234", "abc", ""]) expect(validarPorcentaje(v).ok).toBe(false);
  });

  it("opacidad: entero 1-100 (el 0 la carta lo convierte en 38)", () => {
    expect(valor(validarOpacidad("38"))).toBe("38");
    expect(valor(validarOpacidad("100"))).toBe("100");
    for (const v of ["0", "101", "38.5", "38%"]) expect(validarOpacidad(v).ok).toBe(false);
  });
});

describe("enumerados", () => {
  it("sin distinguir mayúsculas y con alias", () => {
    expect(valor(validarEnum("Fondo", ["fondo", "miniatura", "ambos"]))).toBe("fondo");
    const alias = { "sí": "si", true: "si", "1": "si", yes: "si", false: "no", "0": "no" };
    expect(valor(validarEnum("Sí", ["si", "no"], alias))).toBe("si");
    expect(valor(validarEnum("TRUE", ["si", "no"], alias))).toBe("si");
    expect(valor(validarEnum("0", ["si", "no"], alias))).toBe("no");
    expect(validarEnum("quizás", ["si", "no"], alias).ok).toBe(false);
    expect(validarEnum("toString", ["si", "no"], alias).ok).toBe(false);
  });
});

describe("redes, teléfono y link de Maps", () => {
  it("Instagram: usuario (sin @) o URL https de instagram.com", () => {
    expect(valor(validarRedSocial("@la.parrilla_1", "instagram"))).toBe("la.parrilla_1");
    expect(valor(validarRedSocial("https://www.instagram.com/laparrilla", "instagram"))).toBe("https://www.instagram.com/laparrilla");
    expect(validarRedSocial("http://instagram.com/laparrilla", "instagram").ok).toBe(false);
    expect(validarRedSocial("https://evil.com/laparrilla", "instagram").ok).toBe(false);
    expect(validarRedSocial("javascript:alert(1)", "instagram").ok).toBe(false);
    expect(validarRedSocial("la parrilla", "instagram").ok).toBe(false);
  });

  it("Facebook: usuario o URL https de facebook.com / fb.com", () => {
    expect(valor(validarRedSocial("la-parrilla.bariloche", "facebook"))).toBe("la-parrilla.bariloche");
    expect(valor(validarRedSocial("https://m.facebook.com/laparrilla", "facebook"))).toBe("https://m.facebook.com/laparrilla");
    expect(valor(validarRedSocial("https://fb.com/laparrilla", "facebook"))).toBe("https://fb.com/laparrilla");
    expect(validarRedSocial("https://evil.com", "facebook").ok).toBe(false);
    expect(validarRedSocial("https://facebook.com.evil.com/x", "facebook").ok).toBe(false);
  });

  it("WhatsApp: solo los dígitos, 8 a 15", () => {
    expect(valor(validarTelefono("+54 9 294 123-4567"))).toBe("5492941234567");
    expect(valor(validarTelefono("(011) 4555-1234"))).toBe("01145551234");
    for (const v of ["1234567", "1234567890123456", "294-abc-1234", "+54 9 294 123-4567;"]) expect(validarTelefono(v).ok).toBe(false);
  });

  it("Maps: solo https, sin espacios ni comillas, hasta 500", () => {
    expect(valor(validarUrlHttps("https://maps.app.goo.gl/abc123"))).toBe("https://maps.app.goo.gl/abc123");
    for (const v of ["javascript:alert(1)", "http://maps.google.com/x", "https://maps.google.com/a b", 'https://x.com/"', `https://x.com/${"a".repeat(490)}`]) expect(validarUrlHttps(v).ok).toBe(false);
  });
});
