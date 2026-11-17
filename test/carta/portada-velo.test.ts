import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { razonDeContraste, rgbDeColorCss } from "../../src/core/carta/color-css";
import { TEXTO_SOBRE_FOTO, VELO_ALFA_SOBRE_FOTO } from "../../src/core/carta/portada-velo";
import { resolverEstiloCarta } from "../../src/core/carta/public";
import { contrasteWcag } from "./tema-simple.oraculo";

/**
 * LEGIBILIDAD de la portada CON foto (regla de Pedernal, `carta-libro-especificacion.md` §14.1: 7:1 sobre el PEOR píxel de la caja de cada texto; el texto no depende del color de marca). El peor píxel es el de una foto BLANCA bajo el velo
 * negro (la caja del velo es pareja y cubre todo el bloque: `portada.tsx`). El oráculo de las opacidades está escrito acá a mano y se compara con las clases reales de `portada.tsx`, para que no se muevan sin que este test lo note.
 */
const TEXTOS = [
  { texto: "rubro", opacidad: 0.7, clase: "opacity-70", ancla: "{v.hero_etiqueta_superior}" },
  { texto: "nombre", opacidad: 1, clase: "", ancla: "restauranteNombre}\n        </h1>" },
  { texto: "lugar", opacidad: 0.6, clase: "opacity-60", ancla: "{v.restaurante_subtitulo}" },
  { texto: "descripción", opacidad: 0.75, clase: "opacity-75", ancla: "{v.restaurante_descripcion}" },
] as const;

type Canales = [number, number, number];
const sobreFoto = (foto: Canales, alfa: number): Canales => foto.map((c) => Math.round(c * (1 - alfa))) as Canales;
/** El texto con su opacidad, mezclado en sRGB sobre el fondo (como lo compone el navegador). */
const conOpacidad = (texto: Canales, opacidad: number, fondo: Canales): Canales => texto.map((c, i) => Math.round(c * opacidad + fondo[i]! * (1 - opacidad))) as Canales;

describe("portada con foto: 7:1 en el peor píxel de cada texto", () => {
  const blanco = rgbDeColorCss(TEXTO_SOBRE_FOTO)! as Canales;
  const fotoBlanca: Canales = [255, 255, 255];

  it("el velo valdrá lo declarado: 0,92", () => {
    expect(VELO_ALFA_SOBRE_FOTO).toBe(0.92);
  });

  it.each(TEXTOS)("$texto (opacidad $opacidad) llega a 7:1 sobre una foto blanca, con las dos razones de contraste (la del código y la del oráculo)", ({ opacidad }) => {
    const fondo = sobreFoto(fotoBlanca, VELO_ALFA_SOBRE_FOTO);
    const texto = conOpacidad(blanco, opacidad, fondo);
    expect(razonDeContraste(texto, fondo)).toBeGreaterThanOrEqual(7);
    expect(contrasteWcag(texto, fondo)).toBeGreaterThanOrEqual(7);
  });

  it("cualquier otra foto es más oscura que la blanca, así que también llega (se recorre una escala de grises y los colores puros)", () => {
    const fotos: Canales[] = [[0, 0, 0], [64, 64, 64], [128, 128, 128], [200, 200, 200], [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255], [255, 255, 255]];
    for (const foto of fotos) {
      const fondo = sobreFoto(foto, VELO_ALFA_SOBRE_FOTO);
      for (const { opacidad, texto: nombre } of TEXTOS) expect(razonDeContraste(conOpacidad(blanco, opacidad, fondo), fondo), `${nombre} sobre ${foto}`).toBeGreaterThanOrEqual(7);
    }
  });

  it("el valor es el MÍNIMO redondeado hacia arriba: un velo apenas más claro (0,90) ya no alcanza para el lugar", () => {
    const fondo = sobreFoto(fotoBlanca, 0.9);
    expect(razonDeContraste(conOpacidad(blanco, 0.6, fondo), fondo)).toBeLessThan(7);
  });

  it("las opacidades de este oráculo son las de las clases reales de portada.tsx", () => {
    const fuente = readFileSync("src/components/carta-publica/portada.tsx", "utf8");
    for (const { texto, clase, ancla } of TEXTOS) {
      const desde = fuente.indexOf(ancla);
      expect(desde, `no se encontró el texto ${texto}`).toBeGreaterThan(-1);
      const etiqueta = fuente.slice(fuente.lastIndexOf("<", desde), desde);
      if (clase) expect(etiqueta, texto).toContain(clase);
      else expect(etiqueta, texto).not.toMatch(/opacity-/);
    }
  });

  it("el texto con foto es blanco y NO toma el color de marca: la marca no cambia nada de la portada (se lee de portada.tsx)", () => {
    const fuente = readFileSync("src/components/carta-publica/portada.tsx", "utf8");
    expect(fuente).toContain("bgUrl ? (v.color_portada_textos || estilo.heroInk || TEXTO_SOBRE_FOTO)");
    // Con la marca oscura de la pantalla simple, el color de texto «derivado de la marca» existe en el estilo, pero con foto no se usa.
    const estilo = resolverEstiloCarta({ color_marca: "#ffffff", marca_derivada: "oscura", hero_imagen_fondo_url: "https://cdn.example.com/p.jpg" });
    expect(estilo.portada.colorTexto).not.toBeNull();
    expect(estilo.heroInk).toBeNull();
    expect(estilo.valores.color_portada_textos).toBe("");
  });
});
