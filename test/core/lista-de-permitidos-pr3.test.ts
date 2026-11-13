import { describe, expect, it } from "vitest";
import { sanitizeCssColor } from "@/core/carta/color-css";
import { extraerUrlImagen } from "@/core/carta/portal";
import { validarValorTema } from "@/core/carta/tema";
import { esRemitenteValido } from "@/core/correo/direcciones";
import { validarNombreEnCarta } from "@/core/features/carta/contenido-producto.guard";
import { RUTAS_HIJAS_CON_ACCION_PROPIA } from "@/core/navegacion/estructura";
import { esPathServible } from "@/core/seguridad/ruta-servible";
import { esTextoDeUnaLinea } from "@/core/texto";

/**
 * PR 3 de «Todo nace cerrado» (2026-11-12, rehecho sobre la auditoría): las validaciones por lista de PROHIBIDOS que quedaban tras los pasos 2 a 5 (#239, #240, #241, #249) pasaron a declarar lo que se
 * PERMITE. Cada bloque prueba, por sitio, lo que sigue valiendo, lo que sigue rechazándose y lo NUEVO que ya no entra.
 */

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

describe("texto de una línea (tema «texto», ruta servible)", () => {
  it("vale texto con acentos, emojis, puntuación, símbolos y espacios", () => {
    for (const t of ["Carta de verano", "Ñandú & Cía. (2026) - 50 % off!", "Café ☕ 🍰", "a\u00a0b"]) expect(esTextoDeUnaLinea(t), t).toBe(true);
  });
  it("no vale el vacío ni lo que no es texto de una línea: saltos, tabulaciones, controles, invisibles y separadores", () => {
    for (const t of ["", "a\nb", "a\r", "a\tb", "a\u0000b", "a\u007fb", "a\u200bb", "a\u2028b", "a\ufeffb", "a\u202eb", "a\u0085b", "a\u00adb"]) expect(esTextoDeUnaLinea(t), JSON.stringify(t)).toBe(false);
  });
  it("el tipo «texto» del tema rechaza lo que no es de una línea y acepta el texto común", () => {
    expect(validarValorTema("restaurante_nombre", "Café ☕").ok).toBe(true);
    expect(validarValorTema("restaurante_nombre", "Ca\nfé").ok).toBe(false);
    expect(validarValorTema("restaurante_nombre", "Ca\u200bfé").ok).toBe(false);
  });
  it("una ruta servible exige segmentos decodificados de una línea (los vacíos valen); el resto de sus reglas no cambió", () => {
    expect(esPathServible("/")).toBe(true);
    expect(esPathServible("/a//b")).toBe(true);
    expect(esPathServible("/carta-publica/mi-local/centro")).toBe(true);
    expect(esPathServible("/catalogo/productos/ñandú")).toBe(true);
    expect(esPathServible("/a/%00")).toBe(false);
    expect(esPathServible("/a/%0A")).toBe(false);
    expect(esPathServible("/a/%E2%80%8B")).toBe(false);
    expect(esPathServible("/a/%zz")).toBe(false);
    expect(esPathServible("/carta-publica/a%25b")).toBe(false);
  });
  it("el «Nombre en la carta» con un salto de línea se rechaza (por la lista de permitidos del catálogo)", () => {
    expect(validarNombreEnCarta("Milanesa\nnapolitana").ok).toBe(false);
    expect(validarNombreEnCarta("Milanesa napolitana").ok).toBe(true);
  });
});

describe("remitente del correo: «Nombre <dirección>» con lista de permitidos", () => {
  it("vale una dirección sola o con nombre; no valen comillas, texto de más, saltos ni direcciones rotas", () => {
    for (const r of ["ana@ejemplo.com", "Motor2 Avisos <avisos@ejemplo.com>", "Café Ñandú (Centro) <ana@ejemplo.com>", "O'Brien <o'brien@ejemplo.com>"]) expect(esRemitenteValido(r), r).toBe(true);
    for (const r of ['"Ana" <ana@ejemplo.com>', "Ana <ana@ejemplo.com> x", "Ana\n<ana@ejemplo.com>", "<ana@ejemplo.com>", "Ana <ana ejemplo.com>", "Ana <a@b>", "Ana@x <ana@ejemplo.com>", "Ana <.a..b@ejemplo.com>"]) {
      expect(esRemitenteValido(r), JSON.stringify(r)).toBe(false);
    }
  });
});

describe("ruta hija con acción propia: el id del producto", () => {
  it("el patrón de «en la carta» acepta ids y no otros segmentos", () => {
    const { patron } = RUTAS_HIJAS_CON_ACCION_PROPIA[0];
    expect(patron.test("/catalogo/productos/cmabc123/en-la-carta")).toBe(true);
    for (const r of ["/catalogo/productos//en-la-carta", "/catalogo/productos/a b/en-la-carta", "/catalogo/productos/a/b/en-la-carta", "/catalogo/productos/ñ/en-la-carta"]) expect(patron.test(r), r).toBe(false);
  });
});
