import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { colorDeTextoLegible } from "../../src/core/carta/color-css";
import { resolverEstiloCarta } from "../../src/core/carta/estilo";
import { DEFAULTS_DEL_LIBRO_MAQUETA, LIBRO_ESTILO_MAQUETA, conDefaultsDeLaMaqueta } from "../../src/core/carta/libro-estilo-maqueta";
import { Portada } from "../../src/components/carta-publica/portada";

/**
 * El estilo de la maqueta en el libro de la carta pública (`LIBRO_ESTILO_MAQUETA`, Frente 6; dueño, 2026-11-16: «Sí, igualar al de la maqueta»), los DOS estados. El contraste se calcula acá, aparte del código.
 */
function contrasteHex(a: string, b: string): number {
  const luz = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [luz(a), luz(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const aHex = (rgb: string) => "#" + (rgb.match(/\d+/g) ?? []).map((n) => Number(n).toString(16).padStart(2, "0")).join("");

describe("conDefaultsDeLaMaqueta", () => {
  it("hoy está prendido", () => {
    expect(LIBRO_ESTILO_MAQUETA).toBe(true);
  });
  it("prendido: lo que la sucursal no cargó toma el de la maqueta (fondo oscuro, marca verde, tipografía sans)", () => {
    expect(conDefaultsDeLaMaqueta({}, true)).toEqual(DEFAULTS_DEL_LIBRO_MAQUETA);
    expect(conDefaultsDeLaMaqueta({ color_fondo_dia: "", color_marca: "   ", carta_fuente_familia: 5 }, true)).toMatchObject(DEFAULTS_DEL_LIBRO_MAQUETA);
  });
  it("lo cargado en el Tema manda y no se toca; el resto de las claves pasa igual", () => {
    const cargado = { color_fondo_dia: "#ffffff", color_marca: "#123456", carta_fuente_familia: "lora", hero_etiqueta_superior: "Restaurante" };
    expect(conDefaultsDeLaMaqueta(cargado, true)).toMatchObject(cargado);
    expect(conDefaultsDeLaMaqueta(cargado, true)).toMatchObject({ color_marca: "#123456", carta_fuente_familia: "lora", hero_etiqueta_superior: "Restaurante" });
  });
  it("apagado: devuelve los valores tal cual (un objeto vacío si no era un objeto)", () => {
    expect(conDefaultsDeLaMaqueta({ color_marca: "#123456" }, false)).toEqual({ color_marca: "#123456" });
    expect(conDefaultsDeLaMaqueta(null, false)).toEqual({});
    expect(conDefaultsDeLaMaqueta([1, 2], true)).toEqual(DEFAULTS_DEL_LIBRO_MAQUETA);
  });
  it("no muta lo que recibe", () => {
    const entrada = Object.freeze({ color_marca: "#123456" });
    expect(() => conDefaultsDeLaMaqueta(entrada, true)).not.toThrow();
  });
});

describe("el estilo resuelto con los defaults de la maqueta (accesibilidad)", () => {
  const estilo = resolverEstiloCarta(conDefaultsDeLaMaqueta({}, true));
  it("fondo oscuro, marca verde, tipografía sans y tinta clara derivada del fondo", () => {
    expect(estilo.valores.color_fondo_dia).toBe("#19191a");
    expect(estilo.valores.color_marca).toBe("#6f7d52");
    expect(estilo.variablesCss["--carta-fuente-familia"]).toContain("sans");
    expect(estilo.tintaBase).not.toBeNull();
  });
  it("la marca contra el fondo llega a 3:1 (elementos) y como TEXTO llega a 4,5:1 (AA), con la corrección existente", () => {
    expect(contrasteHex("#6f7d52", "#19191a")).toBeGreaterThanOrEqual(3);
    const texto = estilo.variablesCss["--carta-primary-texto"];
    const comoTexto = texto ? aHex(texto) : "#6f7d52";
    expect(contrasteHex(comoTexto, "#19191a")).toBeGreaterThanOrEqual(4.5);
    expect(colorDeTextoLegible("#6f7d52", "#19191a", estilo.tintaBase)).toBeTruthy();
  });
  it("la tinta de la carta contra el fondo llega a AAA (7:1)", () => {
    expect(contrasteHex("#f2efe9", "#19191a")).toBeGreaterThanOrEqual(7);
  });
});

describe("la portada, los dos estados", () => {
  afterEach(() => vi.resetModules());
  const estilo = resolverEstiloCarta({});
  it("con el estilo de la maqueta y sin imagen ni color de portada: fondo oscuro, arco decorativo y sello con la marca", () => {
    const html = renderToStaticMarkup(<Portada estilo={estilo} restauranteNombre="Huinganco" estiloLibro />);
    expect(html).toContain("data-portada-arco");
    expect(html).toContain("radial-gradient");
    expect(html).toContain("background-color:var(--carta-sello-fondo, var(--carta-primary))"); // el sello
  });
  it("sin el estilo de la maqueta: la portada de siempre (fondo de la marca, sin arco)", () => {
    const html = renderToStaticMarkup(<Portada estilo={estilo} restauranteNombre="Huinganco" />);
    expect(html).not.toContain("data-portada-arco");
    expect(html).toContain("background-color:var(--carta-primary)");
    expect(html).toContain("background-color:var(--carta-ink)"); // el sello de siempre
  });
  it("con una imagen de fondo cargada, la imagen manda: sin arco ni degradé", () => {
    const conImagen = resolverEstiloCarta({ hero_imagen_fondo_url: "https://ejemplo.test/fondo.jpg" });
    const html = renderToStaticMarkup(<Portada estilo={conImagen} restauranteNombre="Huinganco" estiloLibro />);
    expect(html).not.toContain("data-portada-arco");
    expect(html).not.toContain("radial-gradient(120% 70%");
  });
});

describe("contacto y compartir NO dependen del estilo del libro (orquestador, 2026-11-17: «nuestro libro tenía contacto de WhatsApp»)", () => {
  const contacto = {
    restaurante_instagram: "@huinganco",
    restaurante_facebook: "huinganco",
    restaurante_whatsapp: "+54 9 299 123-4567",
    restaurante_footer_maps_url: "https://maps.app.goo.gl/huinganco",
  };
  it("las 4 claves de contacto pasan idénticas con el interruptor en true y en false", () => {
    const base = { ...contacto, color_marca: "#123456" };
    for (const clave of Object.keys(contacto)) {
      expect(conDefaultsDeLaMaqueta(base, true)[clave]).toBe(conDefaultsDeLaMaqueta(base, false)[clave]);
      expect(conDefaultsDeLaMaqueta(base, true)[clave]).toBe((contacto as Record<string, string>)[clave]);
    }
  });
  it("los metadatos (título, descripción, canónica, Open Graph, Twitter, imagen) son idénticos con el interruptor en true y en false", async () => {
    const datos = { origen: "https://carta.ejemplo.test", url: "https://carta.ejemplo.test/huinganco", titulo: "Huinganco", descripcion: "Carta de Huinganco", imagen: "https://ejemplo.test/logo.png", nombreSitio: "Huinganco" };
    const salidas: unknown[] = [];
    for (const valor of [true, false]) {
      vi.resetModules();
      vi.doMock("../../src/core/carta/libro-estilo-maqueta", async (original) => ({ ...(await original<typeof import("../../src/core/carta/libro-estilo-maqueta")>()), LIBRO_ESTILO_MAQUETA: valor }));
      const { metadataDeCartaPublica } = await import("../../src/components/carta-publica/metadatos");
      salidas.push(metadataDeCartaPublica(datos));
      vi.doUnmock("../../src/core/carta/libro-estilo-maqueta");
    }
    expect(salidas[0]).toEqual(salidas[1]);
    expect(salidas[0]).toMatchObject({ title: "Huinganco", openGraph: { images: ["https://ejemplo.test/logo.png"] } });
  });
});

describe("respuestas del dueño, 2026-11-17: rótulo editable, letra, precio, textos de la portada", () => {
  const conLibro = (v: Record<string, unknown>) => resolverEstiloCarta(conDefaultsDeLaMaqueta(v, true));
  const sinLibro = (v: Record<string, unknown>) => resolverEstiloCarta(conDefaultsDeLaMaqueta(v, false));

  it("rótulo de la barra superior: sin valor cargado dice «← Portal» (con el estilo) o «← Menú» (sin él); con valor cargado manda el de la empresa en los dos estados", () => {
    expect(conLibro({}).volver.etiqueta).toBe("← Portal");
    expect(sinLibro({}).volver.etiqueta).toBe("← Menú");
    expect(conLibro({ topbar_back_label: "← Inicio" }).volver.etiqueta).toBe("← Inicio");
    expect(sinLibro({ topbar_back_label: "← Inicio" }).volver.etiqueta).toBe("← Inicio");
  });
  it("letra: con el estilo, nombre, precio y títulos toman el tamaño de la maqueta; lo que la empresa cargó manda; sin el estilo, los de siempre", () => {
    const e = conLibro({});
    expect(e.valores.carta_fuente_item_nombre).toBe("1.35rem");
    expect(e.valores.carta_fuente_item_precio).toBe("1.35rem");
    expect(e.valores.carta_fuente_banda_titulo).toBe("1.4rem");
    expect(e.valores.carta_fuente_indice_titulo).toBe("1.8rem");
    expect(conLibro({ carta_fuente_item_nombre: "1.6rem" }).valores.carta_fuente_item_nombre).toBe("1.6rem");
    expect(sinLibro({}).valores.carta_fuente_item_nombre).toBe("1.1875rem");
  });
  it("precio: blanco (tinta) con el estilo, color de marca sin él; un color de precio cargado manda siempre", async () => {
    vi.resetModules();
    vi.doUnmock("../../src/core/carta/libro-estilo-maqueta");
    const { coloresDelItem } = await import("../../src/components/carta-publica/colores-del-item");
    expect(coloresDelItem(false, conLibro({})).precio).toBe("var(--carta-ink)");
    expect(coloresDelItem(false, conLibro({ color_item_precio: "#ff0000" })).precio).not.toBe("var(--carta-ink)"); // el cargado manda (ajustado a legible)
    vi.resetModules();
    vi.doMock("../../src/core/carta/libro-estilo-maqueta", async (original) => ({ ...(await original<typeof import("../../src/core/carta/libro-estilo-maqueta")>()), LIBRO_ESTILO_MAQUETA: false }));
    const apagado = await import("../../src/components/carta-publica/colores-del-item");
    expect(apagado.coloresDelItem(false, sinLibro({})).precio).toBe(apagado.MARCA_PARA_TEXTO);
    vi.doUnmock("../../src/core/carta/libro-estilo-maqueta");
  });
  it("portada: con el texto de la guía cargado («DESLIZA PARA VER EL MENÚ») se ve ese texto y NO la estrella; sin cargar, no se dibuja ninguno de los dos", () => {
    const con = renderToStaticMarkup(<Portada estilo={conLibro({ carta_texto_portada_cta: "DESLIZA PARA VER EL MENÚ" })} restauranteNombre="Huinganco" estiloLibro />);
    expect(con).toContain("DESLIZA PARA VER EL MENÚ");
    expect(con).not.toContain("✦");
    const sin = renderToStaticMarkup(<Portada estilo={conLibro({})} restauranteNombre="Huinganco" estiloLibro />);
    expect(sin).not.toContain("data-portada-cta");
    expect(sin).not.toContain("✦");
  });
  it("portada: «Restaurante», subtítulo y separador salen del Tema; sin cargar no se dibujan", () => {
    const cargado = renderToStaticMarkup(<Portada estilo={conLibro({ hero_etiqueta_superior: "Restaurante", restaurante_subtitulo: "Hoteles del Neuquén", carta_texto_portada_separador: "✦" })} restauranteNombre="Huinganco" estiloLibro />);
    expect(cargado).toContain("Restaurante");
    expect(cargado).toContain("Hoteles del Neuquén");
    expect(cargado).toContain("✦");
    const vacio = renderToStaticMarkup(<Portada estilo={conLibro({})} restauranteNombre="Huinganco" estiloLibro />);
    expect(vacio).not.toContain("Hoteles del Neuquén");
    expect(vacio).not.toContain("✦");
  });
});

describe("los vínculos (Instagram, WhatsApp, Maps, Facebook) NO son parte del estilo del libro (dueño, 2026-11-17: «no son lo que Motor 2 tenía visualmente y no son lo que yo quería»)", () => {
  const redes = [
    { id: "instagram", label: "Instagram", href: "https://instagram.com/huinganco" },
    { id: "whatsapp", label: "WhatsApp", href: "https://wa.me/5492991234567" },
    { id: "maps", label: "Google Maps", href: "https://maps.app.goo.gl/huinganco" },
    { id: "facebook", label: "Facebook", href: "https://facebook.com/huinganco" },
  ] as const;
  const dibujar = async (precioFuerte: boolean, paginas: { id: string; tipo: "portada" | "indice" | "seccion" }[]) => {
    const { NavegacionCarta } = await import("../../src/components/carta-publica/navegacion-carta");
    const estilo = resolverEstiloCarta({});
    return renderToStaticMarkup(
      <NavegacionCarta paginas={paginas} volver={estilo.volver} colorIconos={null} redesSociales={redes} variablesCss={{}} precioFuerte={precioFuerte}>
        <div />
      </NavegacionCarta>,
    );
  };
  const soloLosVinculos = (html: string) => (html.match(/<a [^>]*href="https:\/\/(?:instagram\.com|wa\.me|maps\.app\.goo\.gl|facebook\.com)[^>]*>/g) ?? []).join("|");

  it("la portada del libro NO dibuja pastillas de texto con los vínculos", () => {
    const html = renderToStaticMarkup(<Portada estilo={resolverEstiloCarta(conDefaultsDeLaMaqueta({}, true))} restauranteNombre="Huinganco" estiloLibro />);
    expect(html).not.toContain("data-portada-redes");
  });
  it("con el estilo prendido y apagado, los vínculos se dibujan idénticos (mismos íconos, mismo orden, mismos enlaces) en la portada y en una sección", async () => {
    // La barra de navegación se dibuja con más de una página; la página actual de entrada es la primera (portada) — la franja de las demás páginas se prueba con la sección primero.
    for (const paginas of [[{ id: "p", tipo: "portada" as const }, { id: "s", tipo: "seccion" as const }], [{ id: "s", tipo: "seccion" as const }, { id: "p", tipo: "portada" as const }]]) {
      const encendido = soloLosVinculos(await dibujar(true, paginas));
      const apagado = soloLosVinculos(await dibujar(false, paginas));
      expect(encendido).not.toBe("");
      expect(encendido).toBe(apagado);
      // El orden de Motor 2: Instagram, WhatsApp, Maps, Facebook.
      expect(encendido.indexOf("instagram.com")).toBeLessThan(encendido.indexOf("wa.me"));
      expect(encendido.indexOf("wa.me")).toBeLessThan(encendido.indexOf("maps.app.goo.gl"));
      expect(encendido.indexOf("maps.app.goo.gl")).toBeLessThan(encendido.indexOf("facebook.com"));
    }
  });
});

describe("el índice del libro no baja la opacidad al pasar el mouse (contraste, axe, 2026-11-17)", () => {
  // El CI vio 3,5:1 en el número de marca (11 px) de la entrada del índice con el mouse encima (`hover:opacity-80` sobre fondo oscuro). En el libro la entrada no cambia de opacidad; subraya el título.
  const carta = {
    version: 1 as const,
    generadoEn: "2026-11-17T12:00:00.000Z",
    sucursal: { id: "s", nombre: "Huinganco" },
    secciones: [{ id: "a", nombre: "Platos", titulo: null, descripcion: null, imagenUrl: null, orden: 1, items: [], promos: [] }],
  };
  const dibujar = async (libro: boolean) => {
    vi.resetModules();
    vi.doMock("../../src/core/carta/libro-estilo-maqueta", async (original) => ({ ...(await original<typeof import("../../src/core/carta/libro-estilo-maqueta")>()), LIBRO_ESTILO_MAQUETA: libro }));
    const { CartaVista } = await import("../../src/components/carta-publica/carta-vista");
    const html = renderToStaticMarkup(<CartaVista carta={carta as never} estilo={resolverEstiloCarta({})} />);
    vi.doUnmock("../../src/core/carta/libro-estilo-maqueta");
    return html;
  };
  const entrada = (html: string) => /<button[^>]*data-ir-a[^>]*>[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";

  it("con el libro: la entrada no lleva `hover:opacity` y el título se subraya al pasar el mouse", async () => {
    const e = entrada(await dibujar(true));
    expect(e).not.toBe("");
    expect(e).not.toContain("hover:opacity");
    expect(e).toContain("group-hover:underline");
  });
  it("sin el libro: la entrada de siempre (baja la opacidad, sin subrayado)", async () => {
    const e = entrada(await dibujar(false));
    expect(e).toContain("hover:opacity-80");
    expect(e).not.toContain("group-hover:underline");
  });
});

describe("contraste del texto de marca con la paleta por defecto del libro (oráculo, WCAG 1.4.3: 4,5:1 para texto chico)", () => {
  const FONDO = DEFAULTS_DEL_LIBRO_MAQUETA.color_fondo_dia!;
  // La marca que se use para TEXTO sale de `--carta-primary-texto`: la marca acercada a la tinta lo justo. Se prueba con la marca por defecto de la maqueta y con otras de cualquier tono.
  for (const marca of [DEFAULTS_DEL_LIBRO_MAQUETA.color_marca!, "#92400e", "#2d6a4f", "#1d3557", "#e63946", "#ffd166", "#000000", "#ffffff"]) {
    it(`marca ${marca} como texto sobre ${FONDO}: ≥ 4,5:1`, () => {
      const e = resolverEstiloCarta(conDefaultsDeLaMaqueta({ color_marca: marca }, true));
      const comoTexto = e.variablesCss["--carta-primary-texto"] ?? marca;
      const hex = /^#/.test(comoTexto) ? comoTexto : "#" + (comoTexto.match(/\d+/g) ?? []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
      expect(contrasteHex(hex, FONDO)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
