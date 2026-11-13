import { describe, expect, it } from "vitest";
import { resolverEstiloCarta } from "@/core/carta/estilo";
import { TINTA_CLARA, TINTA_OSCURA } from "@/core/carta/marca-derivada";
import { CLAVES_TEMA_V1 } from "@/core/carta/tema";
import { CLAVES_DE_COLOR_DEL_TEMA } from "./oraculo-marca";
import { TEMAS_REALES } from "./marca-sin-cambio-fixtures";

/**
 * Modo marca (`marca_derivada = "si"`): la carta se lee SOLO desde `color_marca`; los colores sueltos guardados no se leen (salen vacíos y mandan los tokens del sistema) pero NO se borran de lo guardado (M6: la entrada
 * no se toca). Una marca que no se puede leer cae al color del sistema (falla cerrado).
 */
const ENTRADA: Record<string, string> = { ...TEMAS_REALES.violeta, marca_derivada: "si" };

describe("modo marca: solo cuenta la marca", () => {
  const estilo = resolverEstiloCarta(ENTRADA);

  it("los colores sueltos guardados no se leen: valores vacíos, variables vacías y colores por zona en null", () => {
    for (const [clave, destino] of Object.entries(CLAVES_DE_COLOR_DEL_TEMA)) {
      if (destino === "marca") continue;
      expect(estilo.valores[clave as keyof typeof estilo.valores], clave).toBe("");
    }
    expect(Object.values(estilo.colores).every((c) => c === null)).toBe(true);
    expect(estilo.portada.fondo).toBeNull();
    expect(estilo.portada.colorCta).toBeNull();
    expect(estilo.volver.color).toBeNull();
    expect(estilo.tintaBase).toBeNull();
    expect(estilo.heroInk).toBeNull();
  });

  it("la marca sale como #rrggbb en `--carta-color-marca` y la portada, pintada con la marca, lleva la tinta más legible", () => {
    expect(estilo.valores.color_marca).toBe("#5c57a2");
    expect(estilo.variablesCss["--carta-color-marca"]).toBe("#5c57a2");
    expect(estilo.portada.colorTexto).toBe(TINTA_CLARA);
  });

  it("sobre una marca clara, la tinta de la portada es la oscura", () => {
    expect(resolverEstiloCarta({ color_marca: "#ffcb69", marca_derivada: "si" }).portada.colorTexto).toBe(TINTA_OSCURA);
  });

  it("lo que no es color no cambia (tipografía, textos, posiciones)", () => {
    const sin = resolverEstiloCarta({ ...ENTRADA, carta_fuente_familia: "lora", carta_pos_bloque: "40" });
    expect(sin.familiaTipografica).toBe("lora");
    expect(sin.portada.posBloquePct).toBe(40);
  });

  it("no se toca lo guardado: leer en modo marca no modifica la entrada (los colores sueltos siguen ahí)", () => {
    const entrada = Object.freeze({ ...ENTRADA });
    resolverEstiloCarta(entrada);
    expect(entrada).toEqual(ENTRADA);
    expect(entrada.color_fondo_dia).toBe("#181818");
    expect(entrada.color_item_nombre).toBe("#ffffff");
  });
});

describe("modo marca: la marca guardada se lee si se puede (decisión del dueño, 2026-11-13)", () => {
  it.each([
    ["#5C57A2", "#5c57a2"],
    ["#fff", "#ffffff"],
    ["rgb(92, 87, 162)", "#5c57a2"],
  ])("%s se lee como %s", (guardada, esperada) => {
    expect(resolverEstiloCarta({ color_marca: guardada, marca_derivada: "si" }).valores.color_marca).toBe(esperada);
  });

  it.each(["red", "transparent", "inherit", ""])("%j no se puede leer: la carta usa el color del sistema (sin marca ni tinta)", (guardada) => {
    const estilo = resolverEstiloCarta({ color_marca: guardada, marca_derivada: "si" });
    expect(estilo.valores.color_marca).toBe("");
    expect(estilo.variablesCss["--carta-color-marca"]).toBe("");
    expect(estilo.portada.colorTexto).toBeNull();
  });

  it("sin marca guardada, el modo marca es la carta del sistema", () => {
    const estilo = resolverEstiloCarta({ marca_derivada: "si" });
    expect(estilo.valores.color_marca).toBe("");
    expect(Object.values(estilo.colores).every((c) => c === null)).toBe(true);
  });
});

describe("el marcador es una clave del catálogo, no un color", () => {
  it("está en el catálogo (para que el editor lo guarde), con el único valor «si», y no es de color", () => {
    const d = CLAVES_TEMA_V1.find((c) => c.clave === "marca_derivada");
    expect(d?.tipo).toBe("enum");
    expect(d && "opciones" in d ? d.opciones : null).toEqual(["si"]);
    expect(Object.keys(CLAVES_DE_COLOR_DEL_TEMA)).not.toContain("marca_derivada");
  });
});

describe("la marca es de elementos, el texto usa la tinta del sistema (decisión del dueño, 2026-11-13: «Marca 3:1 y textos con tinta del sistema (Recomendada)»)", () => {
  it("en modo marca, `--carta-primary-texto` es la tinta del sistema (aunque la marca no llegue a 4,5:1); sin marcador es la corrección del PR-A de celular (#265) o no existe", () => {
    expect(resolverEstiloCarta(ENTRADA).variablesCss["--carta-primary-texto"]).toBe("var(--carta-ink)");
    expect(resolverEstiloCarta({ ...TEMAS_REALES.violeta, marca_derivada: "si" }).variablesCss["--carta-primary-texto"]).toBe("var(--carta-ink)");
    // Sin marcador manda el modo clásico: violeta (#5c57a2 sobre #181818) no llega a 4,5:1 y el PR-A de celular acerca la marca a la tinta.
    expect(resolverEstiloCarta(TEMAS_REALES.violeta).variablesCss["--carta-primary-texto"]).toBe("rgb(130, 126, 181)");
    expect(resolverEstiloCarta({}).variablesCss["--carta-primary-texto"]).toBeUndefined();
  });
});
