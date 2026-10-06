import { describe, expect, it } from "vitest";
import { estiloCartaPorDefecto, resolverEstiloCarta } from "@/core/carta/estilo";

describe("resolverEstiloCarta", () => {
  it("sin valores cargados, todo sale en su default del catálogo", () => {
    const estilo = resolverEstiloCarta({});
    expect(estilo.valores.restaurante_nombre).toBe("");
    expect(estilo.valores.carta_banda_alto_mobile).toBe("90px");
    expect(estilo.variablesCss["--carta-banda-alto-mobile"]).toBe("90px");
  });

  it("las claves que ya arrancan con carta_ no duplican el prefijo en el nombre de la variable CSS", () => {
    const estilo = resolverEstiloCarta({});
    expect(estilo.variablesCss).toHaveProperty("--carta-banda-alto-mobile");
    expect(estilo.variablesCss).not.toHaveProperty("--carta-carta-banda-alto-mobile");
    // Una clave que NO arranca con carta_ sigue llevando el prefijo entero.
    expect(estilo.variablesCss).toHaveProperty("--carta-restaurante-nombre");
  });

  it("un valor válido reemplaza al default", () => {
    const estilo = resolverEstiloCarta({ restaurante_nombre: "La Cuadra" });
    expect(estilo.valores.restaurante_nombre).toBe("La Cuadra");
    expect(estilo.variablesCss["--carta-restaurante-nombre"]).toBe("La Cuadra");
  });

  it("un tamaño de fuente guardado como número pelado sale con su unidad (normFuente)", () => {
    const estilo = resolverEstiloCarta({ carta_fuente_item_nombre: "14", topbar_back_size: "11" });
    expect(estilo.valores.carta_fuente_item_nombre).toBe("14px");
    expect(estilo.valores.topbar_back_size).toBe("11px");
  });

  it("un tamaño de fuente que ya trae unidad o es una función CSS no se toca", () => {
    const estilo = resolverEstiloCarta({ carta_fuente_item_nombre: "0.9rem" });
    expect(estilo.valores.carta_fuente_item_nombre).toBe("0.9rem");
  });

  it("el default de una fuente que ya es una función clamp() no se normaliza (no es un número pelado)", () => {
    expect(resolverEstiloCarta({}).valores.carta_fuente_portada_nombre).toBe("clamp(1.7rem, 7vw, 2.1rem)");
  });

  it("un valor inválido cae al default, no rompe ni se cuela crudo", () => {
    const estilo = resolverEstiloCarta({ carta_imagen_opacidad: "no es un número" });
    expect(estilo.valores.carta_imagen_opacidad).toBe("38");
  });

  it("una clave que no es texto (número, objeto) cae al default", () => {
    const estilo = resolverEstiloCarta({ carta_imagen_opacidad: 50 });
    expect(estilo.valores.carta_imagen_opacidad).toBe("38");
  });

  it("claves fuera del catálogo (precio_*, claves no-por-tenant) se ignoran sin error", () => {
    const estilo = resolverEstiloCarta({ precio_simbolo: "€", empresa_nombre: "Otra cosa", color_marca: "#8b4513" });
    expect(estilo.valores.color_marca).toBe("#8b4513");
  });

  it("un Json que no es un objeto (null, array, string) se trata como vacío, sin explotar", () => {
    expect(resolverEstiloCarta(null).valores.restaurante_nombre).toBe("");
    expect(resolverEstiloCarta([1, 2, 3]).valores.restaurante_nombre).toBe("");
    expect(resolverEstiloCarta("no es un objeto").valores.restaurante_nombre).toBe("");
  });

  describe("hero_ink", () => {
    it("sin valor cargado, heroInk es null (el CSS base decide)", () => {
      expect(resolverEstiloCarta({}).heroInk).toBeNull();
    });

    it("'claro' y 'oscuro' se resuelven a un color CSS real, no quedan crudos", () => {
      const claro = resolverEstiloCarta({ hero_ink: "claro" });
      expect(claro.heroInk).toBe("oklch(0.96 0.005 80)");
      expect(claro.variablesCss["--carta-hero-ink"]).toBe("oklch(0.96 0.005 80)");

      const oscuro = resolverEstiloCarta({ hero_ink: "oscuro" });
      expect(oscuro.heroInk).toBe("oklch(0.18 0.02 40)");
    });

    it("un color CSS directo se resuelve tal cual", () => {
      const estilo = resolverEstiloCarta({ hero_ink: "#8b4513" });
      expect(estilo.heroInk).toBe("#8b4513");
    });
  });

  describe("imagenSeccion", () => {
    it("posición y overlay salen tipados, no como strings sueltos", () => {
      const estilo = resolverEstiloCarta({ carta_imagen_pos_x: "right", carta_imagen_pos_y: "bottom", carta_imagen_overlay: "no" });
      expect(estilo.imagenSeccion.posicionX).toBe("right");
      expect(estilo.imagenSeccion.posicionY).toBe("bottom");
      expect(estilo.imagenSeccion.overlay).toBe(false);
    });

    it("overlay acepta los alias sí/no (ALIAS_SI_NO)", () => {
      expect(resolverEstiloCarta({ carta_imagen_overlay: "sí" }).imagenSeccion.overlay).toBe(true);
      expect(resolverEstiloCarta({ carta_imagen_overlay: "false" }).imagenSeccion.overlay).toBe(false);
    });

    it("opacidad sale como número, no como string", () => {
      const estilo = resolverEstiloCarta({ carta_imagen_opacidad: "75" });
      expect(estilo.imagenSeccion.opacidadPct).toBe(75);
      expect(typeof estilo.imagenSeccion.opacidadPct).toBe("number");
    });
  });
});

describe("colores por zona, portada, volver y tinta base", () => {
  it("sin nada cargado: los colores son null (cada componente usa su color de siempre) y 'volver' trae los defaults del catálogo", () => {
    const e = resolverEstiloCarta({});
    expect(Object.values(e.colores).every((c) => c === null)).toBe(true);
    expect(e.portada).toEqual({ fondo: null, colorTexto: null, colorCta: null, posBloquePct: 50, posCtaPct: 18 });
    expect(e.volver).toEqual({ etiqueta: "← Menú", color: null, tamano: "12px" });
    expect(e.tintaBase).toBeNull();
  });

  it("los colores cargados salen en su campo, tal cual", () => {
    const e = resolverEstiloCarta({
      color_indice_titulo: "#111111",
      color_indice_numeros: "#b9b5f0",
      color_indice_titulos: "#222222",
      color_banda_etiqueta: "#b9b5f0",
      color_banda_titulo: "#333333",
      color_banda_descripcion: "#444444",
      color_nav_flechas: "#555555",
      color_nav_iconos: "#666666",
      color_portada_textos: "#ffffff",
      color_portada_cta: "#eeeeee",
    });
    expect(e.colores).toEqual({
      indiceTitulo: "#111111",
      indiceNumeros: "#b9b5f0",
      indiceTitulos: "#222222",
      bandaEtiqueta: "#b9b5f0",
      bandaTitulo: "#333333",
      bandaDescripcion: "#444444",
      navFlechas: "#555555",
      navIconos: "#666666",
    });
    expect(e.portada.colorTexto).toBe("#ffffff");
    expect(e.portada.colorCta).toBe("#eeeeee");
  });

  describe("portada: fondo, color de texto por prioridad y posiciones", () => {
    it("hero_color_fondo sale en portada.fondo", () => {
      expect(resolverEstiloCarta({ hero_color_fondo: "#181818" }).portada.fondo).toBe("#181818");
    });

    it("sin textos ni hero_ink, el texto se deriva por contraste del fondo cargado", () => {
      expect(resolverEstiloCarta({ hero_color_fondo: "#181818" }).portada.colorTexto).toBe("oklch(0.96 0.005 80)");
      expect(resolverEstiloCarta({ hero_color_fondo: "#ffffff" }).portada.colorTexto).toBe("oklch(0.18 0.02 40)");
    });

    it("prioridad: color_portada_textos > hero_ink > derivado del fondo", () => {
      const base = { hero_color_fondo: "#181818" };
      expect(resolverEstiloCarta({ ...base, hero_ink: "oscuro" }).portada.colorTexto).toBe("oklch(0.18 0.02 40)");
      expect(resolverEstiloCarta({ ...base, hero_ink: "oscuro", color_portada_textos: "#ff0000" }).portada.colorTexto).toBe("#ff0000");
    });

    it("las posiciones salen como número y un valor inválido cae al default", () => {
      const e = resolverEstiloCarta({ carta_pos_bloque: "30", carta_pos_cta: "5.5" });
      expect([e.portada.posBloquePct, e.portada.posCtaPct]).toEqual([30, 5.5]);
      const mal = resolverEstiloCarta({ carta_pos_bloque: "150", carta_pos_cta: "abc" });
      expect([mal.portada.posBloquePct, mal.portada.posCtaPct]).toEqual([50, 18]);
    });
  });

  it("un color inválido cae a null (no se cuela crudo al CSS)", () => {
    const e = resolverEstiloCarta({ color_indice_numeros: "red; background:url(x)", color_portada_textos: "no-es-color" });
    expect(e.colores.indiceNumeros).toBeNull();
    expect(e.portada.colorTexto).toBeNull();
  });

  it("volver: etiqueta, color y tamaño (número pelado → px) del topbar", () => {
    const e = resolverEstiloCarta({ topbar_back_label: "← PORTAL", topbar_back_color: "#ffffff", topbar_back_size: "14" });
    expect(e.volver).toEqual({ etiqueta: "← PORTAL", color: "#ffffff", tamano: "14px" });
  });

  it("volver: una etiqueta vacía o inválida cae a '← Menú', nunca a un botón sin texto", () => {
    expect(resolverEstiloCarta({ topbar_back_label: "" }).volver.etiqueta).toBe("← Menú");
  });

  it("banda: defaults 90px mobile / clamp(80px, 18vh, 140px) desktop", () => {
    expect(resolverEstiloCarta({}).banda).toEqual({ altoMobile: "90px", altoDesktop: "clamp(80px, 18vh, 140px)" });
  });

  it("banda: un número pelado sale en px en ambos, una medida o clamp() pasa tal cual", () => {
    expect(resolverEstiloCarta({ carta_banda_alto_mobile: "120", carta_banda_alto_desktop: "200" }).banda).toEqual({ altoMobile: "120px", altoDesktop: "200px" });
    expect(resolverEstiloCarta({ carta_banda_alto_mobile: "12vh", carta_banda_alto_desktop: "clamp(100px, 20vh, 180px)" }).banda).toEqual({
      altoMobile: "12vh",
      altoDesktop: "clamp(100px, 20vh, 180px)",
    });
  });

  it("banda: un valor inválido o fuera de rango (10, 900) cae al default", () => {
    const e = resolverEstiloCarta({ carta_banda_alto_mobile: "10", carta_banda_alto_desktop: "900" });
    expect(e.banda).toEqual({ altoMobile: "90px", altoDesktop: "clamp(80px, 18vh, 140px)" });
  });

  it("tintaBase se deriva del fondo: fondo oscuro → tinta clara, fondo claro → tinta oscura", () => {
    expect(resolverEstiloCarta({ color_fondo_dia: "#181818" }).tintaBase).toBe("oklch(0.96 0.005 80)");
    expect(resolverEstiloCarta({ color_fondo_dia: "#ffffff" }).tintaBase).toBe("oklch(0.18 0.02 40)");
  });
});

describe("familia tipográfica (carta_fuente_familia)", () => {
  it("sin valor cargado: Playfair, con su variable de next/font y respaldo serif en --carta-fuente-familia", () => {
    const e = resolverEstiloCarta({});
    expect(e.familiaTipografica).toBe("playfair");
    expect(e.valores.carta_fuente_familia).toBe("playfair");
    expect(e.variablesCss["--carta-fuente-familia"]).toBe("var(--font-carta-serif, ui-serif, serif), serif");
  });

  it.each([
    ["lora", "var(--font-carta-lora, ui-serif, serif), serif"],
    ["cormorant", "var(--font-carta-cormorant, ui-serif, serif), serif"],
    ["montserrat", "var(--font-carta-montserrat, ui-sans-serif, sans-serif), sans-serif"],
    ["geist", "var(--font-geist-sans, ui-sans-serif, sans-serif), sans-serif"],
  ])("%s → su variable de fuente", (familia, css) => {
    const e = resolverEstiloCarta({ carta_fuente_familia: familia });
    expect(e.familiaTipografica).toBe(familia);
    expect(e.variablesCss["--carta-fuente-familia"]).toBe(css);
  });

  it("es un enum cerrado: un valor libre o desconocido cae a Playfair y nunca llega al CSS", () => {
    for (const malo of ["Comic Sans MS", "serif; color:red", "PLAYFAIR2", "", 42]) {
      const e = resolverEstiloCarta({ carta_fuente_familia: malo });
      expect(e.familiaTipografica).toBe("playfair");
      expect(e.variablesCss["--carta-fuente-familia"]).toBe("var(--font-carta-serif, ui-serif, serif), serif");
    }
  });

  it("acepta mayúsculas (se normaliza como el resto de los enum)", () => {
    expect(resolverEstiloCarta({ carta_fuente_familia: "Lora" }).familiaTipografica).toBe("lora");
  });
});

describe("estiloCartaPorDefecto", () => {
  it("es exactamente resolverEstiloCarta({})", () => {
    expect(estiloCartaPorDefecto()).toEqual(resolverEstiloCarta({}));
  });
});
