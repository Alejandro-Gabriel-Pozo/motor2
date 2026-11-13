import { describe, expect, it } from "vitest";
import { resolvePrimaryForeground, rgbDeColorCss } from "@/core/carta/color-css";
import {
  aHex,
  canalesDeMarcaHex,
  contraste,
  derivarDeMarca,
  esMarcaHex,
  evaluarMarca,
  marcaGuardadaLegible,
  mensajeDeMarca,
  tintaSobreMarca,
  TINTA_CLARA,
  TINTA_OSCURA,
  type Canales,
  type EvaluacionDeMarca,
} from "@/core/carta/marca-derivada";
import { FILAS_DE_MARCA } from "./oraculo-marca";

const BLANCO: Canales = [255, 255, 255];
const NEGRO: Canales = [0, 0, 0];
const canales = (hex: string): Canales => {
  const c = canalesDeMarcaHex(hex);
  if (!c) throw new Error(`no es #rrggbb: ${hex}`);
  return c;
};

describe("contraste WCAG 2.1: la matemática", () => {
  it("negro sobre blanco es 21:1, un color contra sí mismo 1:1 y es simétrico", () => {
    expect(contraste(NEGRO, BLANCO)).toBeCloseTo(21, 5);
    expect(contraste(BLANCO, NEGRO)).toBeCloseTo(21, 5);
    expect(contraste(canales("#5c57a2"), canales("#5c57a2"))).toBeCloseTo(1, 10);
  });

  it("valores conocidos de las marcas reales contra blanco (calculados a mano)", () => {
    expect(contraste(canales("#96bbbb"), BLANCO)).toBeCloseTo(2.07, 1);
    expect(contraste(canales("#ffcb69"), BLANCO)).toBeCloseTo(1.5, 1);
    expect(contraste(canales("#e17360"), BLANCO)).toBeCloseTo(3.08, 1);
    expect(contraste(canales("#5c57a2"), BLANCO)).toBeCloseTo(6.29, 1);
  });
});

describe("oráculo de la marca: tinta derivada, M2 y M3 contra fondo blanco", () => {
  it.each(FILAS_DE_MARCA.map((f) => [f.marca, f] as const))("%s", (_marca, fila) => {
    const evaluacion = evaluarMarca(canales(fila.marca), BLANCO);
    expect(evaluacion.tinta.tinta, fila.nota).toBe(fila.tinta);
    expect(!evaluacion.problemas.includes("TEXTO_SOBRE_MARCA"), `M2: ${fila.nota}`).toBe(fila.pasaTexto);
    expect(!evaluacion.problemas.includes("MARCA_SOBRE_FONDO"), `M3: ${fila.nota}`).toBe(fila.pasaContraBlanco);
    expect(evaluacion.ok).toBe(fila.pasaTexto && fila.pasaContraBlanco);
  });

  it("la tinta elegida es siempre la más legible de las dos (la otra nunca gana)", () => {
    const clara = rgbDeColorCss(TINTA_CLARA);
    const oscura = rgbDeColorCss(TINTA_OSCURA);
    if (!clara || !oscura) throw new Error("no se pudieron leer las tintas fijas");
    for (const fila of FILAS_DE_MARCA) {
      const marca = canales(fila.marca);
      const elegida = tintaSobreMarca(marca);
      const contrasteClara = contraste(marca, clara);
      const contrasteOscura = contraste(marca, oscura);
      expect(elegida.contraste, fila.marca).toBeCloseTo(Math.max(contrasteClara, contrasteOscura), 10);
      expect(elegida.css).toBe(elegida.tinta === "clara" ? TINTA_CLARA : TINTA_OSCURA);
    }
  });

  it("paridad con el criterio de siempre: donde no hay empate, `resolvePrimaryForeground` elige la misma tinta", () => {
    for (const fila of FILAS_DE_MARCA.filter((f) => f.marca !== "#797d62")) {
      const esperada = fila.tinta === "clara" ? TINTA_CLARA : TINTA_OSCURA;
      expect(resolvePrimaryForeground(fila.marca), fila.marca).toBe(esperada);
    }
  });
});

describe("M1: al guardar, #rrggbb en minúsculas y nada más (lista de permitidos)", () => {
  it.each([["#5c57a2", true], ["#000000", true], ["#5C57A2", false], ["#fff", false], ["#5c57a2ff", false], ["#5c57a", false], [" #5c57a2", false], ["#5c57a2 ", false], ["rgb(92, 87, 162)", false], ["red", false], ["", false], ["#gggggg", false]])(
    "%j → %s",
    (valor, esperado) => {
      expect(esMarcaHex(valor)).toBe(esperado);
    },
  );

  it("lo que no es texto no es una marca", () => {
    for (const valor of [null, undefined, 123, {}, [], true]) expect(esMarcaHex(valor)).toBe(false);
  });
});

describe("lectura de una marca ya guardada: se usa si se puede leer (decisión del dueño, 2026-11-13)", () => {
  it.each([
    ["#5c57a2", "#5c57a2"],
    ["#5C57A2", "#5c57a2"],
    ["#fff", "#ffffff"],
    ["#abc", "#aabbcc"],
    ["rgb(92, 87, 162)", "#5c57a2"],
    ["rgba(92, 87, 162, 0.5)", "#5c57a2"],
    ["rgb(300, 0, 0)", "#ff0000"],
    ["hsl(0 0% 100%)", "#ffffff"],
    ["oklch(1 0 0)", "#ffffff"],
    ["  #5c57a2  ", "#5c57a2"],
  ])("%j se lee como %s", (valor, esperado) => {
    expect(marcaGuardadaLegible(valor)).toBe(esperado);
  });

  it.each(["red", "transparent", "inherit", "currentColor", "claro", "oscuro", "", "   ", "#12345", "#5c57a2ff", "rgb()", "color(display-p3 1 0 0)", "x".repeat(65)])("%j no se puede leer → null (la carta usa el color del sistema)", (valor) => {
    expect(marcaGuardadaLegible(valor)).toBeNull();
  });

  it("lo que no es texto da null", () => {
    for (const valor of [null, undefined, 123, {}, [], true]) expect(marcaGuardadaLegible(valor)).toBeNull();
  });

  it("aHex acota y redondea los canales", () => {
    expect(aHex([300, -5, 127.6])).toBe("#ff0080");
  });
});

describe("mensaje al rechazar: dice el problema y qué hacer", () => {
  const evaluacion = (contrasteTexto: number, contrasteFondo: number, problemas: EvaluacionDeMarca["problemas"]): EvaluacionDeMarca => ({
    marca: "#797d62",
    tinta: { tinta: "clara", css: TINTA_CLARA, contraste: contrasteTexto },
    contrasteMarcaFondo: contrasteFondo,
    problemas,
    ok: problemas.length === 0,
  });

  it("sin problemas, el mensaje es vacío", () => {
    expect(mensajeDeMarca(evaluacion(7, 7, []))).toBe("");
  });

  it("texto ilegible: dice el contraste que tiene, el que hace falta y qué hacer", () => {
    const mensaje = mensajeDeMarca(evaluacion(4.09, 7, ["TEXTO_SOBRE_MARCA"]));
    expect(mensaje).toContain("4,09:1");
    expect(mensaje).toContain("hace falta 4,50:1");
    expect(mensaje).toContain("Elegí uno más claro o más oscuro");
  });

  it("marca que se pierde en el fondo: lo dice y qué hacer", () => {
    const mensaje = mensajeDeMarca(evaluacion(7, 2.07, ["MARCA_SOBRE_FONDO"]));
    expect(mensaje).toContain("2,07:1");
    expect(mensaje).toContain("hace falta 3,00:1");
    expect(mensaje).toContain("Elegí uno más fuerte");
  });

  it("nunca muestra un número redondeado hacia arriba hasta el mínimo que no se alcanzó", () => {
    expect(mensajeDeMarca(evaluacion(4.4999, 7, ["TEXTO_SOBRE_MARCA"]))).toContain("4,49:1");
  });

  it("los dos problemas a la vez salen en el mismo mensaje", () => {
    const mensaje = mensajeDeMarca(evaluacion(3, 2, ["TEXTO_SOBRE_MARCA", "MARCA_SOBRE_FONDO"]));
    expect(mensaje).toContain("texto sobre este color");
    expect(mensaje).toContain("fondo de la carta");
  });
});

describe("derivados de la marca: tono de hover y tinte de fondo", () => {
  it("el hover nunca le saca contraste al texto sobre la marca (se mueve hacia la tinta opuesta)", () => {
    for (const fila of FILAS_DE_MARCA) {
      const marca = canales(fila.marca);
      const { tinta, hover } = derivarDeMarca(marca, BLANCO);
      const canalesTinta = rgbDeColorCss(tinta);
      if (!canalesTinta) throw new Error("no se pudo leer la tinta");
      expect(contraste(canales(hover), canalesTinta), fila.marca).toBeGreaterThanOrEqual(contraste(marca, canalesTinta) - 0.02);
    }
  });

  it("el tinte de fondo queda entre el fondo y la marca y es #rrggbb", () => {
    const { tinte, marca } = derivarDeMarca(canales("#5c57a2"), BLANCO);
    expect(marca).toBe("#5c57a2");
    expect(esMarcaHex(tinte)).toBe(true);
    expect(contraste(canales(tinte), BLANCO)).toBeLessThan(contraste(canales("#5c57a2"), BLANCO));
    expect(contraste(canales(tinte), BLANCO)).toBeGreaterThan(1);
  });

  it("todos los derivados son #rrggbb o una de las dos tintas fijas", () => {
    for (const fila of FILAS_DE_MARCA) {
      const d = derivarDeMarca(canales(fila.marca), BLANCO);
      expect(esMarcaHex(d.marca) && esMarcaHex(d.hover) && esMarcaHex(d.tinte)).toBe(true);
      expect([TINTA_CLARA, TINTA_OSCURA]).toContain(d.tinta);
    }
  });
});
