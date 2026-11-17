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
    expect(conDefaultsDeLaMaqueta(cargado, true)).toEqual(cargado);
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
    expect(html).toContain("background-color:var(--carta-primary)"); // el sello
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
