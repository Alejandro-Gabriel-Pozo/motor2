import { describe, expect, it } from "vitest";
import {
  armarTemaCarta,
  CLAVES_FIJAS_DEL_SISTEMA,
  CLAVES_NO_POR_TENANT,
  CLAVES_RETIRADAS,
  CLAVES_TEMA_V1,
  parsearConfigPegada,
  validarValoresTema,
  validarValorTema,
  ZONAS_TEMA,
} from "../../src/core/carta/tema";

/**
 * Catálogo del tema de la carta (docs/plan-tema-carta-2026-09-24.md, M3, D3): las 66 claves por tenant, la clasificación del
 * resto de `SiteConfig`, la paridad con los defaults de la carta, un validador por tipo, el importador ("Pegar desde la sheet")
 * y el saneamiento de la salida del endpoint.
 */

/** D3 del plan, copiado tal cual, por bloque. */
const BLOQUE_A = ["restaurante_nombre", "restaurante_subtitulo", "restaurante_descripcion", "restaurante_logo_url", "hero_imagen_fondo_url", "hero_etiqueta_superior"];
const BLOQUE_B = [
  "color_marca",
  "hero_color_fondo",
  "hero_ink",
  "color_fondo_dia",
  "color_portada_textos",
  "color_portada_cta",
  "color_nav_flechas",
  "color_nav_iconos",
  "color_indice_numeros",
  "color_indice_titulos",
  "color_indice_titulo",
  "color_banda_etiqueta",
  "color_banda_titulo",
  "color_banda_descripcion",
  "color_item_nombre",
  "color_item_precio",
  "color_item_descripcion",
  "color_item_tags",
  "color_especial_item_nombre",
  "color_especial_item_precio",
  "color_especial_item_descripcion",
  "color_especial_item_tags",
  "topbar_back_color",
];
const BLOQUE_C = [
  "carta_texto_portada_cta",
  "carta_texto_portada_separador",
  "carta_texto_indice_etiqueta",
  "carta_texto_indice_titulo",
  "topbar_back_label",
  "restaurante_instagram",
  "restaurante_facebook",
  "restaurante_whatsapp",
  "restaurante_footer_maps_url",
];
const BLOQUE_D = [
  "carta_fuente_banda_etiqueta",
  "carta_fuente_banda_titulo",
  "carta_fuente_banda_descripcion",
  "carta_fuente_item_nombre",
  "carta_fuente_item_precio",
  "carta_fuente_item_descripcion",
  "carta_fuente_item_tags",
  "carta_fuente_portada_etiqueta",
  "carta_fuente_portada_nombre",
  "carta_fuente_portada_subtitulo",
  "carta_fuente_portada_descripcion",
  "carta_fuente_portada_cta",
  "carta_fuente_indice_etiqueta",
  "carta_fuente_indice_titulo",
  "carta_fuente_indice_numero",
  "carta_fuente_indice_item",
  "topbar_back_size",
  "carta_pos_bloque",
  "carta_pos_cta",
  "carta_banda_alto_mobile",
  "carta_banda_alto_desktop",
  "carta_imagen_modo",
  "carta_imagen_ancho_mobile",
  "carta_imagen_ancho_desktop",
  "carta_imagen_pos_x",
  "carta_imagen_pos_y",
  "carta_imagen_overlay",
  "carta_imagen_opacidad",
];

/** Las 109 claves de `SiteConfig`, copiadas en orden de restaurant-menu-design/lib/get-config.ts (commit f4529ce). */
const CLAVES_SITE_CONFIG = [
  "restaurante_nombre", "restaurante_subtitulo", "restaurante_descripcion", "restaurante_boton_hero", "color_marca", "theme_color",
  "favicon_url", "restaurante_logo_url", "lang", "meta_title", "meta_descripcion", "meta_og_image_url",
  "meta_og_locale", "meta_og_url", "meta_twitter_card", "hero_color_fondo", "hero_imagen_fondo_url", "hero_etiqueta_superior",
  "hero_etiqueta_scroll", "hero_ink", "hero_pos_contenido", "hero_pos_contenido_mobile", "hero_pos_logo", "hero_pos_logo_mobile",
  "color_fondo_dia", "color_nav", "color_seccion", "color_especial", "color_cta", "color_tags",
  "color_precio", "color_portada_textos", "color_portada_cta", "color_nav_flechas", "color_nav_iconos", "color_indice_numeros",
  "color_indice_titulos", "color_indice_titulo", "color_banda_etiqueta", "color_banda_titulo", "color_banda_descripcion", "color_item_nombre",
  "color_item_precio", "color_item_descripcion", "color_item_tags", "color_especial_item_nombre", "color_especial_item_precio", "color_especial_item_descripcion",
  "color_especial_item_tags", "empresa_nombre", "empresa_logo_url", "portal_etiqueta", "portal_titulo", "portal_titulo_color",
  "portal_bg_image_url", "portal_bg_overlay", "portal_card_color", "portal_card_color_hover", "portal_card_border_hover", "portal_header_bg",
  "portal_header_color", "portal_etiqueta_color", "portal_card_bg", "portal_card_border", "portal_card_notas_color", "portal_card_flecha_color",
  "topbar_back_label", "topbar_back_size", "topbar_back_color", "restaurante_footer_maps_url", "restaurante_instagram", "restaurante_facebook",
  "restaurante_whatsapp", "precio_simbolo", "precio_locale", "precio_posicion", "carta_pos_bloque", "carta_pos_cta",
  "carta_banda_alto_mobile", "carta_banda_alto_desktop", "carta_imagen_modo", "carta_imagen_ancho_mobile", "carta_imagen_ancho_desktop", "carta_imagen_pos_x",
  "carta_imagen_pos_y", "carta_imagen_overlay", "carta_imagen_opacidad", "carta_fuente_banda_etiqueta", "carta_fuente_banda_titulo", "carta_fuente_banda_descripcion",
  "carta_fuente_item_nombre", "carta_fuente_item_precio", "carta_fuente_item_descripcion", "carta_fuente_item_tags", "carta_fuente_portada_etiqueta", "carta_fuente_portada_nombre",
  "carta_fuente_portada_subtitulo", "carta_fuente_portada_descripcion", "carta_fuente_portada_cta", "carta_fuente_indice_etiqueta", "carta_fuente_indice_titulo", "carta_fuente_indice_numero",
  "carta_fuente_indice_categoria", "carta_fuente_indice_item", "carta_texto_portada_cta", "carta_texto_portada_separador", "carta_texto_indice_etiqueta", "carta_texto_indice_titulo",
  "footer_texto_derechos",
];

/**
 * Los defaults NO VACÍOS de los bloques A a D en `defaults` de restaurant-menu-design/lib/get-config.ts (commit f4529ce), copiados
 * tal cual. Los de las 3 de precio y los de la raíz (lang, meta_twitter_card, hero_pos_*, portal_bg_overlay) no entran.
 *
 * DIVERGENCIA INTENCIONAL (ADR-006, Fase 3, `docs/adr/ADR-006-carta-como-modulo-interno.md`): 10 tamaños de fuente que
 * quedaban por debajo del piso de legibilidad de 11px (`0.6875rem`) se subieron a ese piso — ya no son "tal cual" el
 * original. Quedan marcados con el comentario `// piso 11px` al lado; el resto de la tabla sigue siendo paridad real.
 */
const DEFAULTS_CARTA_NO_VACIOS: Record<string, string> = {
  topbar_back_label: "← Menú",
  topbar_back_size: "12px",
  carta_pos_bloque: "50",
  carta_pos_cta: "18",
  carta_banda_alto_mobile: "90",
  carta_banda_alto_desktop: "clamp(80px, 18vh, 140px)",
  carta_imagen_modo: "fondo",
  carta_imagen_ancho_mobile: "160",
  carta_imagen_ancho_desktop: "auto 100%",
  carta_imagen_pos_x: "left",
  carta_imagen_pos_y: "top",
  carta_imagen_overlay: "si",
  carta_imagen_opacidad: "38",
  carta_fuente_banda_etiqueta: "0.6875rem", // piso 11px (original: 0.55rem)
  carta_fuente_banda_titulo: "0.95rem",
  carta_fuente_banda_descripcion: "0.6875rem", // piso 11px (original: 0.6rem)
  carta_fuente_item_nombre: "0.88rem",
  carta_fuente_item_precio: "0.88rem",
  carta_fuente_item_descripcion: "0.6875rem", // piso 11px (original: 0.68rem)
  carta_fuente_item_tags: "0.6875rem", // piso 11px (original: 0.6rem)
  carta_fuente_portada_etiqueta: "0.6875rem", // piso 11px (original: 0.58rem)
  carta_fuente_portada_nombre: "clamp(1.7rem, 7vw, 2.1rem)",
  carta_fuente_portada_subtitulo: "0.6875rem", // piso 11px (original: 0.6rem)
  carta_fuente_portada_descripcion: "0.75rem",
  carta_fuente_portada_cta: "0.6875rem", // piso 11px (original: 0.5rem)
  carta_fuente_indice_etiqueta: "0.6875rem", // piso 11px (original: 0.5rem)
  carta_fuente_indice_titulo: "clamp(1.2rem, 4vw, 1.75rem)",
  carta_fuente_indice_numero: "0.6875rem", // piso 11px (original: 0.6rem)
  carta_fuente_indice_item: "clamp(0.82rem, 2.5vw, 0.95rem)",
};

const claves = CLAVES_TEMA_V1.map((d) => d.clave as string);
const ordenar = (xs: readonly string[]) => [...xs].sort();

describe("catálogo CLAVES_TEMA_V1", () => {
  it("exactamente las 66 claves de D3 (menos la retirada), con 6/23/9/28 por bloque", () => {
    expect(claves).toHaveLength(66);
    expect(ordenar(claves)).toEqual(ordenar([...BLOQUE_A, ...BLOQUE_B, ...BLOQUE_C, ...BLOQUE_D]));
    const porBloque = (b: string) => ordenar(CLAVES_TEMA_V1.filter((d) => d.bloque === b).map((d) => d.clave));
    expect(porBloque("A")).toEqual(ordenar(BLOQUE_A));
    expect(porBloque("B")).toEqual(ordenar(BLOQUE_B));
    expect(porBloque("C")).toEqual(ordenar(BLOQUE_C));
    expect(porBloque("D")).toEqual(ordenar(BLOQUE_D));
    expect([BLOQUE_A.length, BLOQUE_B.length, BLOQUE_C.length, BLOQUE_D.length]).toEqual([6, 23, 9, 28]);
  });

  it("sin repetidas y sin intersección con las fijas del sistema ni con las que no son por tenant", () => {
    const fijas = Object.keys(CLAVES_FIJAS_DEL_SISTEMA);
    expect(new Set(claves).size).toBe(claves.length);
    expect(new Set(CLAVES_NO_POR_TENANT).size).toBe(CLAVES_NO_POR_TENANT.length);
    expect(claves.filter((c) => fijas.includes(c))).toEqual([]);
    expect(claves.filter((c) => (CLAVES_NO_POR_TENANT as readonly string[]).includes(c))).toEqual([]);
    expect(fijas.filter((c) => (CLAVES_NO_POR_TENANT as readonly string[]).includes(c))).toEqual([]);
  });

  it("66 + 3 + 39 + 1 retirada = las 109 claves de SiteConfig, ni una más ni una menos", () => {
    expect(CLAVES_SITE_CONFIG).toHaveLength(109);
    expect(Object.keys(CLAVES_FIJAS_DEL_SISTEMA)).toHaveLength(3);
    expect(CLAVES_NO_POR_TENANT).toHaveLength(39);
    expect(CLAVES_RETIRADAS).toEqual(["carta_fuente_indice_categoria"]);
    expect(claves).not.toContain("carta_fuente_indice_categoria");
    expect(ordenar([...claves, ...Object.keys(CLAVES_FIJAS_DEL_SISTEMA), ...CLAVES_NO_POR_TENANT, ...CLAVES_RETIRADAS])).toEqual(ordenar(CLAVES_SITE_CONFIG));
  });

  it("las 3 fijas del sistema son las de precio, con la convención argentina", () => {
    expect(CLAVES_FIJAS_DEL_SISTEMA).toEqual({ precio_locale: "es-AR", precio_simbolo: "$", precio_posicion: "izquierda" });
  });

  it("las etiquetas no se repiten (son el nombre del campo en el formulario y en los mensajes de error)", () => {
    const etiquetas = CLAVES_TEMA_V1.map((d) => d.etiqueta as string);
    expect(etiquetas.filter((e, i) => etiquetas.indexOf(e) !== i)).toEqual([]);
  });

  it("ninguna clave precio_* en el catálogo", () => {
    expect(claves.filter((c) => c.startsWith("precio_"))).toEqual([]);
  });

  it("cada clave tiene tipo, zona (de las 14), etiqueta y defaultCarta; las 14 zonas se usan", () => {
    for (const d of CLAVES_TEMA_V1) {
      expect(typeof d.tipo, d.clave).toBe("string");
      expect(ZONAS_TEMA, d.clave).toContain(d.zona);
      expect(d.etiqueta.trim().length, d.clave).toBeGreaterThan(0);
      expect(typeof d.defaultCarta, d.clave).toBe("string");
    }
    expect(ZONAS_TEMA).toHaveLength(14);
    expect(ordenar([...new Set(CLAVES_TEMA_V1.map((d) => d.zona))])).toEqual(ordenar(ZONAS_TEMA));
  });
});

describe("paridad con los defaults de la carta", () => {
  it("defaultCarta es el default de get-config.ts (los no vacíos, tal cual salvo el piso de 11px de ADR-006; el resto vacío)", () => {
    for (const d of CLAVES_TEMA_V1) expect(d.defaultCarta, d.clave).toBe(DEFAULTS_CARTA_NO_VACIOS[d.clave] ?? "");
    expect(Object.keys(DEFAULTS_CARTA_NO_VACIOS).every((c) => claves.includes(c))).toBe(true);
  });

  it.each(Object.entries(DEFAULTS_CARTA_NO_VACIOS))("el default de %s pasa su validador sin cambios", (clave, valor) => {
    expect(validarValorTema(clave, valor)).toEqual({ ok: true, valor });
  });
});

describe("validarValorTema: un caso bueno y uno malo de cada tipo", () => {
  const CASOS: { clave: string; bueno: string; normalizado?: string; malo: string }[] = [
    { clave: "color_item_nombre", bueno: "oklch(0.5 0.1 30)", malo: "red;background:x" },
    { clave: "hero_ink", bueno: "Claro", normalizado: "claro", malo: "light blue" },
    { clave: "hero_color_fondo", bueno: "#AbC", normalizado: "#aabbcc", malo: "oklch(0.5 0.1 30)" },
    { clave: "carta_fuente_item_nombre", bueno: "clamp(0.8rem, 2vw, 1rem)", malo: "12pt" },
    { clave: "carta_banda_alto_mobile", bueno: "120", malo: "10" },
    { clave: "carta_banda_alto_desktop", bueno: "120", normalizado: "120px", malo: "1px}*{x:y" },
    { clave: "carta_imagen_ancho_mobile", bueno: "80", malo: "calc(1px)" },
    { clave: "carta_imagen_ancho_desktop", bueno: "contain", malo: "auto auto auto" },
    { clave: "carta_pos_bloque", bueno: "42.5", malo: "150" },
    { clave: "carta_imagen_opacidad", bueno: "60", malo: "0" },
    { clave: "carta_imagen_modo", bueno: "Miniatura", normalizado: "miniatura", malo: "mosaico" },
    { clave: "carta_imagen_overlay", bueno: "Sí", normalizado: "si", malo: "tal vez" },
    { clave: "restaurante_instagram", bueno: "@laparrilla", normalizado: "laparrilla", malo: "https://evil.com/x" },
    { clave: "restaurante_facebook", bueno: "https://www.facebook.com/laparrilla", malo: "http://facebook.com/laparrilla" },
    { clave: "restaurante_whatsapp", bueno: "+54 9 294 123-4567", normalizado: "5492941234567", malo: "123" },
    { clave: "restaurante_footer_maps_url", bueno: "https://maps.app.goo.gl/x", malo: "javascript:alert(1)" },
    { clave: "carta_texto_portada_separador", bueno: "✦", malo: "12345678901" },
    { clave: "restaurante_nombre", bueno: "La Parrilla <de> \"Juan\"", malo: "Uno\nDos" },
    { clave: "restaurante_logo_url", bueno: "https://cdn.example.com/logo.png", malo: "http://cdn.example.com/logo.png" },
  ];

  it.each(CASOS)("$clave", ({ clave, bueno, normalizado, malo }) => {
    expect(validarValorTema(clave, bueno)).toEqual({ ok: true, valor: normalizado ?? bueno });
    expect(validarValorTema(clave, malo).ok).toBe(false);
  });

  it("los alias claro/oscuro solo valen en hero_ink", () => {
    expect(validarValorTema("hero_ink", "oscuro")).toEqual({ ok: true, valor: "oscuro" });
    expect(validarValorTema("color_marca", "claro")).toMatchObject({ ok: false, mensaje: expect.stringMatching(/solo valen para el texto de la portada/) });
    expect(validarValorTema("hero_color_fondo", "oscuro").ok).toBe(false);
  });

  it("colores de hasta 100 caracteres", () => {
    expect(validarValorTema("color_marca", `rgb(${"1".repeat(96)})`).ok).toBe(false);
  });

  it("vacío → null (default de la carta); clave fuera del catálogo → error", () => {
    expect(validarValorTema("color_marca", "   ")).toEqual({ ok: true, valor: null });
    expect(validarValorTema("precio_locale", "es-AR").ok).toBe(false);
    expect(validarValorTema("meta_title", "x").ok).toBe(false);
  });
});

describe("validarValoresTema", () => {
  it("normaliza, omite los vacíos e ignora lo que no es del catálogo (incluidas las precio_*)", () => {
    const r = validarValoresTema({ color_marca: " #8B4513 ", carta_banda_alto_desktop: "120", carta_imagen_overlay: "Sí", restaurante_nombre: "", precio_simbolo: "US$", foo: "bar" });
    expect(r).toEqual({ ok: true, valor: { color_marca: "#8B4513", carta_banda_alto_desktop: "120px", carta_imagen_overlay: "si" } });
  });

  it("junta hasta 5 errores en un mensaje, con la etiqueta en castellano", () => {
    const r = validarValoresTema({
      color_marca: "red;x",
      hero_color_fondo: "oklch(0.5 0.1 30)",
      carta_banda_alto_desktop: "1px}*{x:y",
      restaurante_footer_maps_url: "javascript:alert(1)",
      restaurante_instagram: "https://evil.com",
      carta_imagen_opacidad: "0",
      carta_pos_cta: "500",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mensaje).toMatch(/^Revisá estos campos: /);
    expect(r.mensaje).toContain("Color de marca (acento): ");
    // En el orden del formulario (el del catálogo): los 5 primeros, y los otros 2 se cuentan.
    expect(r.mensaje).toContain("Link de Google Maps: ");
    expect(r.mensaje).not.toContain("Alto de la banda en desktop: ");
    expect(r.mensaje.split(" · ")).toHaveLength(5);
    expect(r.mensaje).toMatch(/\(y 2 más\)\.$/);
  });
});

describe("parsearConfigPegada (Pegar desde la sheet)", () => {
  it("clasifica un pegado real de la tab Config", () => {
    const pegado = [
      "clave\tvalor",
      "",
      "restaurante_nombre\t  La Parrilla  ",
      "color_marca\t#8B4513",
      "meta_title\tLa Parrilla — Carta 2026",
      "precio_locale\tes-AR",
      "color_item_precio\tno-es-un-color;",
      "carta_banda_alto_desktop\t90px}body{display:none",
      "carta_fuente_item_nombre\tclamp(0.8rem, 2vw, 1rem)",
      "color_banda_titulo\t",
      "clave_vieja	x",
      "carta_fuente_indice_categoria	0.7rem",
      "   ",
      "carta_banda_alto_mobile\t120\tcolumna C ignorada",
      'restaurante_descripcion\t"Cocina de ""autor"""',
    ].join("\r\n");
    const r = parsearConfigPegada(pegado);
    expect(r.valores).toEqual({
      restaurante_nombre: "La Parrilla",
      color_marca: "#8B4513",
      carta_fuente_item_nombre: "clamp(0.8rem, 2vw, 1rem)",
      carta_banda_alto_mobile: "120",
      restaurante_descripcion: 'Cocina de "autor"',
    });
    expect(r.fijasDelSistema).toEqual(["precio_locale"]);
    expect(r.noPorTenant).toEqual(["meta_title"]);
    expect(r.retiradas).toEqual(["carta_fuente_indice_categoria"]);
    expect(r.desconocidas).toEqual(["clave_vieja"]);
    expect(r.invalidas.map((i) => i.clave)).toEqual(["color_item_precio", "carta_banda_alto_desktop"]);
    expect(r.invalidas.every((i) => i.motivo.length > 0)).toBe(true);
  });

  it("si una clave se repite gana la última (como getConfig)", () => {
    expect(parsearConfigPegada("color_marca\tred\ncolor_marca\tblue").valores).toEqual({ color_marca: "blue" });
  });

  it("vacío → todo vacío", () => {
    expect(parsearConfigPegada("")).toEqual({ valores: {}, fijasDelSistema: [], noPorTenant: [], retiradas: [], desconocidas: [], invalidas: [] });
  });
});

describe("armarTemaCarta: saneamiento de la salida", () => {
  const ahora = new Date("2026-09-24T12:00:00.000Z");
  const actualizadoEn = new Date("2026-09-24T11:00:00.000Z");

  it("con un Json cargado a mano: lo inválido sale null, lo ajeno no sale, y siempre salen exactamente las 66 claves", () => {
    const tema = armarTemaCarta(
      {
        sucursalId: "suc-1",
        actualizadoEn,
        valores: {
          color_marca: "red;x",
          carta_banda_alto_desktop: "1px}*{x:y",
          precio_simbolo: "US$",
          foo: "bar",
          carta_imagen_opacidad: 38,
          color_item_nombre: "#123456",
          carta_banda_alto_mobile: "120",
        },
      },
      ahora
    );
    expect(tema.version).toBe(1);
    expect(tema.generadoEn).toBe(ahora.toISOString());
    expect(tema.actualizadoEn).toBe(actualizadoEn.toISOString());
    expect(tema.sucursalId).toBe("suc-1");
    expect(ordenar(Object.keys(tema.valores))).toEqual(ordenar(claves));
    expect(tema.valores.color_marca).toBeNull();
    expect(tema.valores.carta_banda_alto_desktop).toBeNull();
    expect(tema.valores.carta_imagen_opacidad).toBeNull();
    expect(tema.valores.color_item_nombre).toBe("#123456");
    expect(tema.valores.carta_banda_alto_mobile).toBe("120");
    expect(tema.valores.restaurante_nombre).toBeNull();
    expect("precio_simbolo" in tema.valores).toBe(false);
    expect("foo" in tema.valores).toBe(false);
  });

  it("vuelve a normalizar lo guardado (un 120 cargado a mano en el alto de desktop sale 120px)", () => {
    expect(armarTemaCarta({ sucursalId: "s", actualizadoEn, valores: { carta_banda_alto_desktop: "120" } }, ahora).valores.carta_banda_alto_desktop).toBe("120px");
  });

  it.each([null, [], "texto", 42])("un Json que no es un objeto (%j) → las 66 en null", (valores) => {
    const tema = armarTemaCarta({ sucursalId: "s", actualizadoEn, valores }, ahora);
    expect(Object.keys(tema.valores)).toHaveLength(66);
    expect(Object.values(tema.valores).every((v) => v === null)).toBe(true);
  });
});
