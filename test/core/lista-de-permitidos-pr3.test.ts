import { describe, expect, it } from "vitest";
import { urlImagenSegura } from "@/core/carta/armar-menu";
import { sanitizeCssColor } from "@/core/carta/color-css";
import { imagenParaCompartir } from "@/core/carta/metadatos";
import { extraerUrlImagen } from "@/core/carta/portal";
import { tieneFormaDeUrlHttps } from "@/core/carta/url-https";
import { esDireccionValida, esRemitenteValido } from "@/core/correo/direcciones";
import { validarNombreEnCarta } from "@/core/features/carta/contenido-producto.guard";
import { rutaInternaSegura } from "@/core/navegacion/volver";
import { validarAltaDeAdmin } from "@/core/plataforma/primer-admin";
import { claveDeConfiguracion } from "@/core/pos/promo-combo";
import { esPathServible } from "@/core/seguridad/ruta-servible";
import { esTextoDeUnaLinea } from "@/core/texto";

/**
 * PR 3 de «Todo nace cerrado» (2026-11-12): las validaciones por lista de PROHIBIDOS pasaron a declarar lo que se PERMITE. Cada bloque prueba, por sitio, lo que sigue valiendo, lo que sigue
 * rechazándose y lo NUEVO que ahora no entra (lo que la lista de prohibidos dejaba pasar por no haberlo pensado: invisibles, caracteres fuera de ASCII, comillas, etc.).
 */

describe("URL https de imagen (armar-menu, css-valores, metadatos): solo ASCII de una URL", () => {
  it("vale una URL normal con ruta, consulta y %XX", () => {
    for (const u of ["https://img.ejemplo.com/a.jpg", "https://img.ejemplo.com/a%20b.jpg?w=800&q=80#x", "HTTPS://Img.Ejemplo.com/a-b_c~d.png"]) {
      expect(tieneFormaDeUrlHttps(u), u).toBe(true);
      expect(urlImagenSegura(u), u).not.toBeNull();
      expect(imagenParaCompartir(u), u).toBe(u);
    }
  });
  it("sigue rechazando lo de siempre", () => {
    for (const u of ["http://a.com/x.jpg", "https://", "https://a.com/a b.jpg", 'https://a.com/"x', "https://a.com/x'y", "https://a.com/(x)", "https://a.com/x\\y", "https://a.com/<x>", "https://a.com/x`y", "javascript:alert(1)", "https://a.com/x\ny"]) {
      expect(tieneFormaDeUrlHttps(u), u).toBe(false);
      expect(urlImagenSegura(u), u).toBeNull();
    }
  });
  it("lo nuevo que ya no entra: caracteres invisibles, fuera de ASCII y corchetes", () => {
    for (const u of ["https://a.com/x​y", "https://a.com/ñ.jpg", "https://a.com/x\u0000", "https://a.com/x y", "https://[::1]/x.jpg"]) {
      expect(tieneFormaDeUrlHttps(u), JSON.stringify(u)).toBe(false);
      expect(imagenParaCompartir(u), JSON.stringify(u)).toBeNull();
    }
  });
});

describe("color CSS: la lista de permitidos es la única puerta", () => {
  it("valen hex, funciones, nombres y los alias; no valen los caracteres de inyección", () => {
    for (const c of ["#fff", "#8b4513", "rgb(1, 2, 3)", "oklch(60% 0.1 20)", "red", "claro", "oscuro"]) expect(sanitizeCssColor(c), c).toBe(c);
    for (const c of ["red;color:blue", "red}", "#fff<", 'rgb("x")', "rgb(1,2,3)\\", "url(x)", "", "re\nd"]) expect(sanitizeCssColor(c), JSON.stringify(c)).toBeNull();
  });
});

describe("extraerUrlImagen: saca la URL de un link de markdown o de paréntesis", () => {
  it("las tres formas y los casos raros", () => {
    expect(extraerUrlImagen("[logo](https://a.com/x.png)")).toBe("https://a.com/x.png");
    expect(extraerUrlImagen("(https://a.com/x.png)")).toBe("https://a.com/x.png");
    expect(extraerUrlImagen("  https://a.com/x.png ")).toBe("https://a.com/x.png");
    expect(extraerUrlImagen("[logo]( https://a.com/x.png )")).toBe("https://a.com/x.png");
    expect(extraerUrlImagen("[a](b)(c)")).toBe("b");
    expect(extraerUrlImagen("[a]()")).toBe("[a]()");
    expect(extraerUrlImagen("[a](b")).toBe("[a](b");
    expect(extraerUrlImagen("(a(b))")).toBe("(a(b))");
    expect(extraerUrlImagen("()")).toBe("()");
  });
});

describe("texto de una línea (tema «texto», asunto de mail, ruta servible)", () => {
  it("vale texto con acentos, emojis, puntuación, símbolos y espacios", () => {
    for (const t of ["", "Carta de verano", "Ñandú & Cía. (2026) - 50 % off!", "Café ☕ 🍰", "a b"]) expect(esTextoDeUnaLinea(t), t).toBe(true);
  });
  it("no vale lo que no es texto de una línea: saltos, tabulaciones, controles, invisibles y separadores", () => {
    for (const t of ["a\nb", "a\r", "a\tb", "a\u0000b", "a\u007fb", "a​b", "a b", "a﻿b", "a‮b", "a\u0085b", "a­b"]) expect(esTextoDeUnaLinea(t), JSON.stringify(t)).toBe(false);
  });
  it("una ruta servible exige segmentos decodificados de una línea; el resto de sus reglas no cambió", () => {
    expect(esPathServible("/carta-publica/mi-local/centro")).toBe(true);
    expect(esPathServible("/catalogo/productos/ñandú")).toBe(true);
    expect(esPathServible("/a/%00")).toBe(false);
    expect(esPathServible("/a/%0A")).toBe(false);
    expect(esPathServible("/a/%E2%80%8B")).toBe(false);
    expect(esPathServible("/a/%zz")).toBe(false);
    expect(esPathServible("/carta-publica/a%25b")).toBe(false);
  });
  it("el «Nombre en la carta» con un salto de línea se rechaza (por la lista de permitidos)", () => {
    expect(validarNombreEnCarta("Milanesa\nnapolitana").ok).toBe(false);
    expect(validarNombreEnCarta("Milanesa napolitana").ok).toBe(true);
  });
});

describe("correo: dirección y remitente", () => {
  it("valen las direcciones comunes", () => {
    for (const d of ["ana@ejemplo.com", "ana.perez+avisos@mail.ejemplo.com.ar", "a_b-c%d@x-y.co"]) expect(esDireccionValida(d), d).toBe(true);
  });
  it("no valen espacios, comillas, comas, paréntesis, <>, controles, fuera de ASCII ni formas rotas", () => {
    for (const d of ["ana@ejemplo", "ana @ejemplo.com", "ana@ejemplo.com ", '"ana"@ejemplo.com', "ana,b@ejemplo.com", "ana(b)@ejemplo.com", "<ana@ejemplo.com>", "ana@ejemplo.com\n", "ñ@ejemplo.com", "ana@ejemplo.com​", "ana@-ejemplo.com", "ana@ejemplo..com", "@ejemplo.com", `${"a".repeat(65)}@ejemplo.com`, `ana@${"a".repeat(64)}.com`]) {
      expect(esDireccionValida(d), JSON.stringify(d)).toBe(false);
    }
  });
  it("el remitente es una dirección sola o «Nombre <dirección>»", () => {
    for (const r of ["ana@ejemplo.com", "Motor2 Avisos <avisos@ejemplo.com>", "Café Ñandú (Centro) <ana@ejemplo.com>"]) expect(esRemitenteValido(r), r).toBe(true);
    for (const r of ['"Ana" <ana@ejemplo.com>', "Ana <ana@ejemplo.com> x", "Ana\n<ana@ejemplo.com>", "<ana@ejemplo.com>", "Ana <ana ejemplo.com>", "Ana <a@b>", "Ana@x <ana@ejemplo.com>"]) expect(esRemitenteValido(r), JSON.stringify(r)).toBe(false);
  });
  it("el alta del primer admin de la plataforma usa la misma forma", () => {
    expect(validarAltaDeAdmin({ email: "Ana@Ejemplo.com", nombre: " Ana " })).toMatchObject({ email: "ana@ejemplo.com", nombre: "Ana" });
    expect(() => validarAltaDeAdmin({ email: "ana ejemplo.com", nombre: "Ana" })).toThrow(/email/i);
    expect(() => validarAltaDeAdmin({ email: "ana@ejem\nplo.com", nombre: "Ana" })).toThrow(/email/i);
  });
});

describe("volver: ruta interna segura", () => {
  it("vale una ruta con consulta; no valen espacios, controles, no ASCII, barras invertidas ni rutas ajenas", () => {
    expect(rutaInternaSegura("/catalogo/productos?x=1&y=%20")).toBe("/catalogo/productos?x=1&y=%20");
    for (const v of ["/a b", "/a\tb", "/a\u0000", "/ñ", "/a\\b", "//sitio", "/\\sitio", "https://sitio", "/", "/login", "/api/x", "/a\u007f", "/a​"]) expect(rutaInternaSegura(v), JSON.stringify(v)).toBeNull();
  });
});

describe("clave de configuración de un combo: ids de opción", () => {
  it("vale un id normal; no valen separadores, espacios ni vacíos", () => {
    expect(claveDeConfiguracion([{ opcionId: "cmabc123", cantidad: 2 }, { opcionId: "cmaaa000", cantidad: 1 }])).toBe("cmaaa000=1;cmabc123=2");
    for (const id of ["a;b", "a=b", "a b", "", "a\nb", "ñ"]) expect(claveDeConfiguracion([{ opcionId: id, cantidad: 1 }]), JSON.stringify(id)).toBeNull();
  });
});
