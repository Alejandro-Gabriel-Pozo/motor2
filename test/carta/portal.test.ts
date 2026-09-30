import { describe, expect, it } from "vitest";
import { CLAVES_NO_POR_TENANT, CLAVES_TEMA_V1 } from "../../src/core/carta/tema";
import {
  CLAVES_PORTAL_V1,
  decidirLayoutPortal,
  extraerUrlImagen,
  posicionCompleta,
  PROPORCION_MAPA_POR_DEFECTO,
  resolverEstiloPortal,
  validarValorPortal,
  validarValoresPortal,
  type PosicionPortal,
} from "../../src/core/carta/portal";

/**
 * Config del portal de la empresa (ADR-006): catálogo, validación, resolución a estilo y decisión mapa/grilla. Todo puro.
 */

const claves = CLAVES_PORTAL_V1.map((d) => d.clave as string);
const POS: PosicionPortal = { x: 30, y: 40, w: 50, h: null };
const suc = (slug: string, posicion: PosicionPortal | null) => ({ slug, posicion });

describe("catálogo CLAVES_PORTAL_V1", () => {
  it("sin claves repetidas y sin cruce con las 67 del tema por sucursal", () => {
    expect(new Set(claves).size).toBe(claves.length);
    const tema = new Set<string>(CLAVES_TEMA_V1.map((d) => d.clave));
    expect(claves.filter((c) => tema.has(c))).toEqual([]);
  });

  it("cubre todas las claves de portal de la config raíz original (portal_*, logo y derechos)", () => {
    const originales = (CLAVES_NO_POR_TENANT as readonly string[]).filter((c) => c.startsWith("portal_") || c === "empresa_logo_url" || c === "footer_texto_derechos");
    expect(originales).toHaveLength(17);
    expect(originales.filter((c) => !claves.includes(c))).toEqual([]);
  });

  it("todo default no vacío pasa su propia validación y sale igual (es un valor que el formulario aceptaría)", () => {
    for (const d of CLAVES_PORTAL_V1) {
      if (!d.defaultPortal) continue;
      expect(validarValorPortal(d.clave, d.defaultPortal), d.clave).toEqual({ ok: true, valor: d.defaultPortal });
    }
  });

  it("el tamaño de letra por defecto es legible (mínimo 0.75rem el nombre y 0.7rem el subtítulo)", () => {
    const def = (c: string) => CLAVES_PORTAL_V1.find((d) => d.clave === c)?.defaultPortal ?? "";
    expect(def("portal_card_fuente_label")).toMatch(/^clamp\(0\.75rem,/);
    expect(def("portal_card_fuente_notas")).toMatch(/^clamp\(0\.7rem,/);
  });
});

describe("extraerUrlImagen", () => {
  it("saca la URL de un link de markdown, de un paréntesis o la deja pelada", () => {
    expect(extraerUrlImagen("[mapa](https://x.com/m.png)")).toBe("https://x.com/m.png");
    expect(extraerUrlImagen("  [](https://x.com/m.png) ")).toBe("https://x.com/m.png");
    expect(extraerUrlImagen("(https://x.com/m.png)")).toBe("https://x.com/m.png");
    expect(extraerUrlImagen(" https://x.com/m.png ")).toBe("https://x.com/m.png");
  });
});

describe("validarValorPortal", () => {
  it("vacío → null; clave ajena → error; no texto → error", () => {
    expect(validarValorPortal("portal_titulo", "   ")).toEqual({ ok: true, valor: null });
    expect(validarValorPortal("color_marca", "#fff").ok).toBe(false);
    expect(validarValorPortal("portal_titulo", 5).ok).toBe(false);
  });

  it("imagen: acepta https y el link de markdown; rechaza http y comillas", () => {
    expect(validarValorPortal("portal_bg_image_url", "[m](https://x.com/m.png)")).toEqual({ ok: true, valor: "https://x.com/m.png" });
    expect(validarValorPortal("empresa_logo_url", "https://x.com/l.png")).toEqual({ ok: true, valor: "https://x.com/l.png" });
    expect(validarValorPortal("portal_bg_image_url", "http://x.com/m.png").ok).toBe(false);
    expect(validarValorPortal("portal_bg_image_url", 'https://x.com/"m".png').ok).toBe(false);
  });

  it("color: acepta hex y rechaza basura", () => {
    expect(validarValorPortal("portal_card_bg", "#112233").ok).toBe(true);
    expect(validarValorPortal("portal_card_bg", "red; background:url(x)").ok).toBe(false);
  });

  it("overlay: de 0 a 1; fuera de rango o no numérico se rechaza", () => {
    expect(validarValorPortal("portal_bg_overlay", "0.4")).toEqual({ ok: true, valor: "0.4" });
    expect(validarValorPortal("portal_bg_overlay", ".5")).toEqual({ ok: true, valor: "0.5" });
    expect(validarValorPortal("portal_bg_overlay", "1")).toEqual({ ok: true, valor: "1" });
    for (const malo of ["-1", "2", "1.5", "abc", "0.123"]) expect(validarValorPortal("portal_bg_overlay", malo).ok, malo).toBe(false);
  });

  it("proporción: ancho/alto o un número; rechaza lo extremo y lo que no es número", () => {
    expect(validarValorPortal("portal_bg_proporcion", "1080/1533")).toEqual({ ok: true, valor: "1080/1533" });
    expect(validarValorPortal("portal_bg_proporcion", "16 : 9")).toEqual({ ok: true, valor: "16/9" });
    expect(validarValorPortal("portal_bg_proporcion", "0.7")).toEqual({ ok: true, valor: "0.7" });
    for (const malo of ["0/10", "1/100", "100/1", "abc", "1/0", "10", "calc(1+1)"]) expect(validarValorPortal("portal_bg_proporcion", malo).ok, malo).toBe(false);
  });

  it("tamaños de letra y alto de tarjeta: reutilizan las reglas del tema", () => {
    expect(validarValorPortal("portal_card_fuente_label", "14")).toEqual({ ok: true, valor: "14" });
    expect(validarValorPortal("portal_card_fuente_label", "1rem; x").ok).toBe(false);
    expect(validarValorPortal("portal_card_alto_defecto", "8")).toEqual({ ok: true, valor: "8" });
    expect(validarValorPortal("portal_card_alto_defecto", "101").ok).toBe(false);
  });
});

describe("validarValoresPortal", () => {
  it("devuelve los valores normalizados, omite vacíos y claves ajenas", () => {
    const r = validarValoresPortal({ portal_titulo: " Sucursales ", portal_etiqueta: "", color_marca: "#fff", portal_bg_overlay: 0.3 });
    expect(r).toEqual({ ok: true, valor: { portal_titulo: "Sucursales", portal_bg_overlay: "0.3" } });
  });

  it("junta hasta 5 errores con la etiqueta de cada campo", () => {
    const r = validarValoresPortal({ portal_bg_overlay: "9", portal_bg_proporcion: "x", portal_card_bg: "a;b", portal_card_border: "a;b", portal_card_color: "a;b", portal_header_bg: "a;b", portal_header_color: "a;b" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.mensaje).toMatch(/^Revisá estos campos: /);
      expect(r.mensaje).toMatch(/\(y 2 más\)\.$/);
    }
  });
});

describe("resolverEstiloPortal", () => {
  it("sin config: defaults, sin imagen, overlay 0, proporción original", () => {
    const e = resolverEstiloPortal({});
    expect(e.imagenFondo).toBeNull();
    expect(e.overlay).toBe(0);
    expect(e.proporcion).toBe(PROPORCION_MAPA_POR_DEFECTO);
    expect(e.altoTarjetaPct).toBe(6);
    expect(e.variablesCss["--portal-card-fuente-label"]).toBe("clamp(0.75rem, 2.2vw, 0.95rem)");
    expect(e.variablesCss["--portal-card-bg"]).toBeUndefined();
  });

  it("valores cargados: variables CSS solo para color/fuente/porcentaje; imagen y overlay como datos", () => {
    const e = resolverEstiloPortal({
      portal_card_bg: "#112233",
      portal_card_fuente_label: "14",
      portal_bg_image_url: "https://x.com/m.png",
      portal_bg_overlay: "0.5",
      portal_bg_proporcion: "3/4",
      portal_titulo: "Hola",
    });
    expect(e.variablesCss["--portal-card-bg"]).toBe("#112233");
    expect(e.variablesCss["--portal-card-fuente-label"]).toBe("14px");
    expect(e.imagenFondo).toBe("https://x.com/m.png");
    expect(e.overlay).toBe(0.5);
    expect(e.proporcion).toBe("3/4");
    expect(Object.keys(e.variablesCss).filter((k) => k.includes("image") || k.includes("logo") || k === "--portal-titulo")).toEqual([]);
  });

  it("un Json cargado a mano con basura cae al default (overlay -1, 2 o 'abc' → 0; proporción o imagen inválidas → default)", () => {
    for (const malo of ["-1", "2", "abc", 7, null]) expect(resolverEstiloPortal({ portal_bg_overlay: malo }).overlay, String(malo)).toBe(0);
    const e = resolverEstiloPortal({ portal_bg_proporcion: "cero", portal_bg_image_url: "http://x.com/m.png", portal_card_bg: "red; x" });
    expect(e.proporcion).toBe(PROPORCION_MAPA_POR_DEFECTO);
    expect(e.imagenFondo).toBeNull();
    expect(e.variablesCss["--portal-card-bg"]).toBeUndefined();
  });

  it("alto de tarjeta 0 cae al default (una tarjeta sin alto no se ve ni se puede tocar)", () => {
    expect(resolverEstiloPortal({ portal_card_alto_defecto: "0" }).altoTarjetaPct).toBe(6);
    expect(resolverEstiloPortal({ portal_card_alto_defecto: "9" }).altoTarjetaPct).toBe(9);
  });

  it("un Json que no es objeto (array, string, null) equivale a {}", () => {
    for (const raro of [[], "x", null, undefined, 3]) expect(resolverEstiloPortal(raro).imagenFondo).toBeNull();
  });
});

describe("posicionCompleta", () => {
  it("x, y y w son obligatorios; h es opcional", () => {
    expect(posicionCompleta(10, 20, 30, null)).toEqual({ x: 10, y: 20, w: 30, h: null });
    expect(posicionCompleta(10, 20, 30, 8)).toEqual({ x: 10, y: 20, w: 30, h: 8 });
    expect(posicionCompleta(null, 20, 30, 8)).toBeNull();
    expect(posicionCompleta(10, null, 30, 8)).toBeNull();
    expect(posicionCompleta(10, 20, null, 8)).toBeNull();
    expect(posicionCompleta(10, 20, Number.NaN, 8)).toBeNull();
  });
});

describe("decidirLayoutPortal", () => {
  const IMG = "https://x.com/m.png";

  it("imagen + al menos una posición completa → mapa; las demás van en la grilla de abajo", () => {
    const l = decidirLayoutPortal([suc("a", POS), suc("b", null), suc("c", POS)], IMG);
    expect(l.modo).toBe("mapa");
    expect(l.enMapa.map((s) => s.slug)).toEqual(["a", "c"]);
    expect(l.enGrilla.map((s) => s.slug)).toEqual(["b"]);
  });

  it("sin imagen → grilla con TODAS (aunque tengan posición)", () => {
    const l = decidirLayoutPortal([suc("a", POS), suc("b", null)], null);
    expect(l.modo).toBe("grilla");
    expect(l.enMapa).toEqual([]);
    expect(l.enGrilla.map((s) => s.slug)).toEqual(["a", "b"]);
  });

  it("imagen pero ninguna posición completa → grilla", () => {
    const l = decidirLayoutPortal([suc("a", null), suc("b", null)], IMG);
    expect(l.modo).toBe("grilla");
    expect(l.enGrilla).toHaveLength(2);
  });

  it("sin sucursales → grilla vacía", () => {
    expect(decidirLayoutPortal([], IMG)).toEqual({ modo: "grilla", enMapa: [], enGrilla: [] });
  });
});
