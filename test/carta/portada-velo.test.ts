import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rgbDeColorCss } from "../../src/core/carta/color-css";
import { TEXTO_SOBRE_FOTO, VELO_ALFA_SOBRE_FOTO, VELO_DEGRADE_SOBRE_FOTO, VELO_MESETA, alfaDelVeloEnFraccion, fraccionDeLaEsquinaDelBloque } from "../../src/core/carta/portada-velo";
import { resolverEstiloCarta } from "../../src/core/carta/public";
import { contrasteWcag } from "./tema-simple.oraculo";

/**
 * LEGIBILIDAD de la portada CON foto (regla de Pedernal, `carta-libro-especificacion.md` §14.1: 7:1 sobre el PEOR píxel de la caja de cada texto; el texto no depende del color de marca; dueño, 2026-11-17: «Opcion 2»: velo a 0,67, textos sin
 * atenuar, y sin forma de caja). El peor píxel es el de una foto BLANCA bajo el velo negro. Con foto, TODOS los textos van con opacidad 1 (la atenuación es solo de la portada sin foto); el oráculo de eso se compara con `portada.tsx`.
 */
const TEXTOS = ["rubro", "nombre", "lugar", "descripción", "separador"] as const;
const ANCLAS: Record<string, { ancla: string; sinFoto: string }> = {
  rubro: { ancla: "{v.hero_etiqueta_superior}", sinFoto: "opacity-70" },
  lugar: { ancla: "{v.restaurante_subtitulo}", sinFoto: "opacity-60" },
  descripción: { ancla: "{v.restaurante_descripcion}", sinFoto: "opacity-75" },
  separador: { ancla: "{v.carta_texto_portada_separador}", sinFoto: "opacity-40" },
};

type Canales = [number, number, number];
const sobreFoto = (foto: Canales, alfa: number): Canales => foto.map((c) => Math.round(c * (1 - alfa))) as Canales;

describe("portada con foto: 7:1 en el peor píxel de cada texto", () => {
  const blanco = rgbDeColorCss(TEXTO_SOBRE_FOTO)! as Canales;
  const fotoBlanca: Canales = [255, 255, 255];

  it("el velo vale lo declarado por el dueño: 0,67 (opción 2), con meseta pareja hasta 0,65 del radio", () => {
    expect(VELO_ALFA_SOBRE_FOTO).toBe(0.67);
    expect(VELO_MESETA).toBe(0.65);
  });

  it.each(TEXTOS)("%s (opacidad 1) llega a 7:1 sobre una foto blanca, en el centro y en toda la meseta del velo", () => {
    const fondo = sobreFoto(fotoBlanca, alfaDelVeloEnFraccion(0));
    expect(contrasteWcag(blanco, fondo)).toBeGreaterThanOrEqual(7);
    for (let r = 0; r <= VELO_MESETA; r += 0.01) expect(alfaDelVeloEnFraccion(r)).toBe(VELO_ALFA_SOBRE_FOTO);
  });

  it("el alfa mínimo que sirve es 0,66 (con 0,65 ya no llega): 0,67 es el valor decidido y tiene margen mínimo", () => {
    expect(contrasteWcag(blanco, sobreFoto(fotoBlanca, 0.67))).toBeGreaterThanOrEqual(7);
    expect(contrasteWcag(blanco, sobreFoto(fotoBlanca, 0.65))).toBeLessThan(7.05);
  });

  it("el PEOR píxel de la caja de cada texto cae dentro de la meseta: la esquina de cualquier bloque (de 60×40 a 1200×900 px; las cajas de los textos están DENTRO del bloque, que es la caja de todos) queda a ≤ 0,65 del radio, y el elemento del velo escala con el bloque", () => {
    for (const ancho of [60, 120, 200, 311, 320, 500, 800, 1200]) {
      for (const alto of [40, 100, 200, 300, 450, 600, 900]) {
        const r = fraccionDeLaEsquinaDelBloque(ancho, alto);
        const peor = sobreFoto(fotoBlanca, alfaDelVeloEnFraccion(r));
        expect(r, `${ancho}×${alto}`).toBeLessThanOrEqual(VELO_MESETA);
        expect(contrasteWcag(blanco, peor), `${ancho}×${alto}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  it("cualquier otra foto es más oscura que la blanca, así que también llega (escala de grises y colores puros)", () => {
    const fotos: Canales[] = [[0, 0, 0], [64, 64, 64], [128, 128, 128], [200, 200, 200], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255], [255, 255, 255]];
    for (const foto of fotos) expect(contrasteWcag(blanco, sobreFoto(foto, VELO_ALFA_SOBRE_FOTO)), `sobre ${foto}`).toBeGreaterThanOrEqual(7);
  });

  it("la forma NO es una caja: es un degradé elíptico que baja de a poco hasta 0 en el borde (monótono, sin saltos de más de 0,25 entre pasos)", () => {
    expect(VELO_DEGRADE_SOBRE_FOTO).toMatch(/^radial-gradient\(ellipse closest-side,/);
    let anterior = alfaDelVeloEnFraccion(VELO_MESETA);
    for (let r = VELO_MESETA; r <= 1.0001; r += 0.05) {
      const a = alfaDelVeloEnFraccion(r);
      expect(a).toBeLessThanOrEqual(anterior + 1e-9);
      expect(anterior - a).toBeLessThan(0.25);
      anterior = a;
    }
    expect(alfaDelVeloEnFraccion(1)).toBe(0);
    expect(VELO_DEGRADE_SOBRE_FOTO).toMatch(/0 0 0 \/ 0\) 100%\)$/);
  });

  it("con foto los textos no se atenúan: la opacidad de rubro, lugar, descripción y separador solo se pone sin foto (se lee de portada.tsx)", () => {
    const fuente = readFileSync("src/components/carta-publica/portada.tsx", "utf8");
    for (const [texto, { ancla, sinFoto }] of Object.entries(ANCLAS)) {
      const desde = fuente.indexOf(ancla);
      expect(desde, `no se encontró el texto ${texto}`).toBeGreaterThan(-1);
      const etiqueta = fuente.slice(fuente.lastIndexOf("<", desde), desde);
      expect(etiqueta, texto).toContain(`bgUrl ? "" : " ${sinFoto}"`);
    }
    const nombre = fuente.slice(fuente.lastIndexOf("<h1"), fuente.indexOf("</h1>"));
    expect(nombre).not.toMatch(/opacity-/);
  });

  it("el texto con foto es blanco y NO toma el color de marca (se lee de portada.tsx)", () => {
    const fuente = readFileSync("src/components/carta-publica/portada.tsx", "utf8");
    expect(fuente).toContain("bgUrl ? (v.color_portada_textos || estilo.heroInk || TEXTO_SOBRE_FOTO)");
    const estilo = resolverEstiloCarta({ color_marca: "#ffffff", marca_derivada: "oscura", hero_imagen_fondo_url: "https://cdn.example.com/p.jpg" });
    expect(estilo.heroInk).toBeNull();
    expect(estilo.valores.color_portada_textos).toBe("");
  });
});
