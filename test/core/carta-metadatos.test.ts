import { describe, expect, it } from "vitest";
import {
  descripcionDeCartaDeSucursal,
  descripcionDelPortal,
  imagenParaCompartir,
  LARGO_MAXIMO_DESCRIPCION_PUBLICA,
  LARGO_MAXIMO_TITULO_PUBLICO,
  recortarTexto,
  tituloDeCartaDeSucursal,
  tituloDelPortal,
} from "@/core/carta/metadatos";
import { MARCA_PUBLICA } from "@/core/carta/marca";
import { origenPublicoDeCarta } from "@/core/carta/carta-empresa-unica";

/** La parte pública no muestra el nombre de la aplicación: ningún texto armado acá puede mencionarlo. */
const SIN_NOMBRE_DE_LA_APP = /motor2|\berp\b/i;

describe("títulos", () => {
  it("la carta de una sucursal es «<nombre> · Carta · <marca>»", () => {
    expect(tituloDeCartaDeSucursal("El Pirquinero")).toBe(`El Pirquinero · Carta · ${MARCA_PUBLICA}`);
  });
  it("no repite la marca si el nombre ya la trae", () => {
    expect(tituloDeCartaDeSucursal(`${MARCA_PUBLICA} Centro`)).toBe(`${MARCA_PUBLICA} Centro · Carta`);
  });
  it("si con la marca no entra en 60, se queda con «<nombre> · Carta»; si ni eso entra, recorta con «…»", () => {
    const largo = "Restaurante Panorámico del Alto Valle";
    expect(tituloDeCartaDeSucursal(largo)).toBe(`${largo} · Carta`);
    const larguisimo = "Restaurante ".repeat(10);
    const t = tituloDeCartaDeSucursal(larguisimo);
    expect(t.length).toBeLessThanOrEqual(LARGO_MAXIMO_TITULO_PUBLICO);
    expect(t.endsWith("…")).toBe(true);
  });
  it("el portal usa el título cargado por el comercio (con la marca) o «<marca> · Cartas»", () => {
    expect(tituloDelPortal("Nuestras sucursales")).toBe(`Nuestras sucursales · ${MARCA_PUBLICA}`);
    expect(tituloDelPortal(`Bienvenidos a ${MARCA_PUBLICA}`)).toBe(`Bienvenidos a ${MARCA_PUBLICA}`);
    expect(tituloDelPortal("")).toBe(`${MARCA_PUBLICA} · Cartas`);
    expect(tituloDelPortal(null)).toBe(`${MARCA_PUBLICA} · Cartas`);
  });
  it("ninguno menciona el nombre de la aplicación", () => {
    for (const t of [tituloDeCartaDeSucursal("X"), tituloDelPortal(null), tituloDelPortal("Y")]) expect(t).not.toMatch(SIN_NOMBRE_DE_LA_APP);
  });
});

describe("descripciones", () => {
  it("sin descripción propia: «Carta de <nombre> — <marca>.» y las secciones", () => {
    expect(descripcionDeCartaDeSucursal({ nombre: "El Pirquinero", secciones: ["Entradas", "Platos", "Postres"] })).toBe(`Carta de El Pirquinero — ${MARCA_PUBLICA}. Entradas, Platos, Postres.`);
  });
  it("sin secciones: solo el encabezado (la frase neutra)", () => {
    expect(descripcionDeCartaDeSucursal({ nombre: "El Pirquinero", secciones: [] })).toBe(`Carta de El Pirquinero — ${MARCA_PUBLICA}.`);
  });
  it("con descripción propia del comercio, esa", () => {
    expect(descripcionDeCartaDeSucursal({ nombre: "X", descripcionPropia: "  Cocina   patagónica de autor.  ", secciones: ["A"] })).toBe("Cocina patagónica de autor.");
  });
  it("nunca pasa de 160, ni con muchas secciones ni con una descripción propia enorme", () => {
    const muchas = Array.from({ length: 40 }, (_, i) => `Sección número ${i}`);
    const d = descripcionDeCartaDeSucursal({ nombre: "El Pirquinero", secciones: muchas });
    expect(d.length).toBeLessThanOrEqual(LARGO_MAXIMO_DESCRIPCION_PUBLICA);
    expect(d.endsWith("…")).toBe(true);
    expect(descripcionDeCartaDeSucursal({ nombre: "X", descripcionPropia: "a".repeat(500), secciones: [] }).length).toBeLessThanOrEqual(LARGO_MAXIMO_DESCRIPCION_PUBLICA);
  });
  it("el portal lista las sucursales (singular con una sola) y sin sucursales cae en la frase neutra", () => {
    expect(descripcionDelPortal(["Centro", "Costa"])).toBe(`Cartas de ${MARCA_PUBLICA}: Centro, Costa.`);
    expect(descripcionDelPortal(["Centro"])).toBe(`Carta de ${MARCA_PUBLICA}: Centro.`);
    expect(descripcionDelPortal([])).toBe(`Cartas de ${MARCA_PUBLICA}.`);
  });
  it("ninguna menciona el nombre de la aplicación", () => {
    for (const d of [descripcionDeCartaDeSucursal({ nombre: "X", secciones: ["A"] }), descripcionDelPortal(["A", "B"]), descripcionDelPortal([])]) expect(d).not.toMatch(SIN_NOMBRE_DE_LA_APP);
  });
});

describe("recortarTexto e imagenParaCompartir", () => {
  it("limpia espacios, no toca lo que entra y corta en límite de palabra", () => {
    expect(recortarTexto("  a   b  ", 10)).toBe("a b");
    expect(recortarTexto("uno dos tres cuatro cinco", 16)).toBe("uno dos tres…");
  });
  it("la imagen para compartir es la del comercio y solo si es https; si no, ninguna (no se inventa)", () => {
    expect(imagenParaCompartir("https://cdn.ejemplo.com/logo.png")).toBe("https://cdn.ejemplo.com/logo.png");
    expect(imagenParaCompartir("http://cdn.ejemplo.com/logo.png")).toBeNull();
    expect(imagenParaCompartir("javascript:alert(1)")).toBeNull();
    expect(imagenParaCompartir("")).toBeNull();
    expect(imagenParaCompartir(null)).toBeNull();
  });
});

describe("origenPublicoDeCarta", () => {
  it("<empresa>.<dominio base> por https", () => {
    expect(origenPublicoDeCarta("carta.ejemplo.com.ar", undefined, "hotel")).toBe("https://hotel.carta.ejemplo.com.ar");
  });
  it("con el add-on de empresa única, el dominio base pelado; con otra empresa, su subdominio", () => {
    expect(origenPublicoDeCarta("carta.ejemplo.com.ar", "hotel", "hotel")).toBe("https://carta.ejemplo.com.ar");
    expect(origenPublicoDeCarta("carta.ejemplo.com.ar", "hotel", "otra")).toBe("https://otra.carta.ejemplo.com.ar");
  });
  it("en localhost/*.localhost, http (sin certificado); sin dominio base, null (solo hay ruta técnica)", () => {
    expect(origenPublicoDeCarta("carta.localhost", undefined, "e2e")).toBe("http://e2e.carta.localhost");
    expect(origenPublicoDeCarta(undefined, undefined, "e2e")).toBeNull();
    expect(origenPublicoDeCarta("  ", undefined, "e2e")).toBeNull();
  });
});
