import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardián: en la carta pública, un TEXTO nunca se pinta con `var(--carta-primary)` a secas. Tiene que leer `var(--carta-primary-texto, var(--carta-primary))`: así, en modo marca (la marca es de elementos, >= 3:1) el
 * texto usa la tinta del sistema y sin marcador sigue valiendo la marca de siempre. Los usos de `--carta-primary` que NO son texto (fondo de la portada, ★, bordes, barras, flechas) se listan acá, con su motivo.
 */
const RAIZ = join(__dirname, "../..");
/** La forma correcta de pintar un texto con la marca: se quita antes de buscar usos a secas (contiene, adentro, `var(--carta-primary)`). */
const USO_CORRECTO = "var(--carta-primary-texto, var(--carta-primary))";
const ARCHIVOS = ["seccion.tsx", "carta-vista.tsx", "portada.tsx", "navegacion-carta.tsx"].map((a) => `src/components/carta-publica/${a}`);

/** Usos permitidos de `var(--carta-primary)` a secas dentro de estos componentes, por línea (texto exacto) y motivo. */
const NO_SON_TEXTO: ReadonlyArray<{ contiene: string; motivo: string }> = [
  { contiene: "estrella:", motivo: "la ★ es un glifo (elemento, 3:1)" },
  { contiene: "backgroundColor: bgUrl ? undefined : (p.fondo", motivo: "fondo de la portada: la tinta derivada va encima" },
  { contiene: "backgroundColor: \"color-mix(in oklch, var(--carta-primary) 12%", motivo: "tinte de fondo de la pastilla (el texto va con --carta-primary-texto)" },
  { contiene: "var(--carta-flechas, var(--carta-primary))", motivo: "flechas de la navegación (elementos)" },
  { contiene: "//", motivo: "comentario" },
];

describe("la carta pública no pinta texto con la marca a secas", () => {
  it.each(ARCHIVOS)("%s", (ruta) => {
    const lineas = readFileSync(join(RAIZ, ruta), "utf8").split("\n");
    const sueltos = lineas
      .map((texto, i) => ({ texto, n: i + 1 }))
      .filter(({ texto }) => texto.replaceAll(USO_CORRECTO, "").includes("var(--carta-primary)") && !NO_SON_TEXTO.some((a) => texto.includes(a.contiene)))
      .map(({ texto, n }) => `${ruta}:${n}: ${texto.trim().slice(0, 140)}`);
    expect(sueltos, "un texto con `var(--carta-primary)` a secas: usá var(--carta-primary-texto, var(--carta-primary)), o si es un elemento (no texto) declaralo en NO_SON_TEXTO").toEqual([]);
  });
});
