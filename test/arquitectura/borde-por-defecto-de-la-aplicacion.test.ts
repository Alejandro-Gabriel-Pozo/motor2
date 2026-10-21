import { describe, expect, it } from "vitest";
import { RAIZ_DEL_REPO, leer, sinComentarios } from "./cercos/trinquete";
import { leerReglas, reglaDelAncla, type ReglaCss } from "./contratos/adaptadores/css";
import { TOKENS_VISUALES } from "./contratos/contratos/tokens-visuales";

/**
 * Defensa por defecto del color de los bordes de TODA la aplicación (`src/app/globals.css`, Fase 6). El preflight de Tailwind resetea cada borde con `border: 0 solid` y un borde sin color
 * declarado cae a `currentColor`, el color del TEXTO (negro): en la administración, los recuadros y las tablas con `border` a secas salían con un contorno negro. La red de seguridad: dentro
 * de `@layer base`, todo (`*`, `::before`, `::after`, `::backdrop`, `::file-selector-button`) arranca con `border-color: var(--color-borde-control)`.
 *  - Es el borde de CONTROLES (gris medio, 3,6:1 sobre blanco y 3,5:1 sobre papel, WCAG 1.4.11) y NO el decorativo claro (`--color-borde`): un `<input>` con solo `border` perdería el contraste de
 *    objeto. Lo decorativo (separadores, tarjetas) usa `border-borde` explícito.
 *  - Va en `@layer base` a propósito, DESPUÉS del preflight de Tailwind (también `base`; gana por orden): no le gana a las utilidades (`@layer utilities`: `border-red-500`, `border-borde`) ni a las
 *    reglas sin capa. La carta pública tiene la suya, más específica (`.carta-shell *`, `border-color: var(--carta-border)`; ver `test/carta/borde-por-defecto.test.ts`) y sigue ganando.
 * Mutación demostrada (rojo y revertida; ver `logs/fase6/64-demostraciones.txt`): sacar la regla, o sacarla de `@layer base`.
 */
const SELECTORES_ESPERADOS = ["*", "::after", "::backdrop", "::before", "::file-selector-button"];
const COLOR_POR_DEFECTO = "var(--color-borde-control)";

const reglas: ReglaCss[] = leerReglas(sinComentarios(leer(RAIZ_DEL_REPO, TOKENS_VISUALES.fuente.archivo), TOKENS_VISUALES.fuente.archivo));
const valorDe = (regla: ReglaCss, propiedad: string): string | undefined => regla.declaraciones.find((d) => d.propiedad === propiedad)?.valor;
const selectoresDe = (regla: ReglaCss): string[] => regla.selector.split(",").map((s) => s.trim().replace(/\s+/g, " "));

/** Las reglas que ponen `border-color` a TODO (el selector universal): la defensa por defecto. `.carta-shell *` y las demás reglas con un selector más específico no son esta. */
const defensas = reglas.filter((r) => selectoresDe(r).includes("*") && valorDe(r, "border-color") !== undefined);
const capasBase = reglas.filter((r) => r.selector === "@layer base");
const dentroDeBase = (r: ReglaCss): boolean => capasBase.some((c) => c.desde < r.desde && r.hasta < c.hasta);

describe("la aplicación: un borde sin color declarado cae al borde de controles (gris medio), nunca al color del texto", () => {
  it("hay UNA regla por defecto, que cubre `*`, `::before`, `::after`, `::backdrop` y `::file-selector-button` (como el preflight de Tailwind)", () => {
    expect(defensas.length, "la regla `*, ::after, ::before… { border-color: … }` no está").toBe(1);
    expect(selectoresDe(defensas[0]).sort()).toEqual(SELECTORES_ESPERADOS);
  });

  it("la regla está DENTRO de `@layer base` (fuera de la capa le ganaría a las utilidades de Tailwind y a la carta pública)", () => {
    expect(defensas.length, "la regla por defecto no está").toBe(1);
    expect(dentroDeBase(defensas[0]), "la regla por defecto tiene que estar dentro de `@layer base`").toBe(true);
  });

  it("usa `var(--color-borde-control)`, el token del borde de controles, y no el decorativo ni un color suelto", () => {
    expect(defensas.length, "la regla por defecto no está").toBe(1);
    expect(valorDe(defensas[0], "border-color")).toBe(COLOR_POR_DEFECTO);
    // El token existe en `@theme static` (el contrato `tokens-visuales` también lo exige: un `var()` de un token que no está es `uso-sin-declarar`).
    const ancla = reglaDelAncla(reglas, TOKENS_VISUALES.fuente.ancla);
    expect(ancla?.declaraciones.some((d) => d.propiedad === "--color-borde-control"), "--color-borde-control en @theme static").toBe(true);
  });

  it("no hay otra regla con `border-color` sobre el selector universal fuera de la capa (sin capa le ganaría a las utilidades)", () => {
    const sueltas = reglas.filter((r) => selectoresDe(r).some((s) => s === "*" || s === "::before" || s === "::after") && valorDe(r, "border-color") !== undefined && !dentroDeBase(r));
    expect(sueltas.map((r) => r.selector)).toEqual([]);
  });

  it("la carta pública conserva su propia regla (más específica): `.carta-shell *` sigue con `var(--carta-border)`", () => {
    const carta = reglas.filter((r) => selectoresDe(r).includes(".carta-shell *") && dentroDeBase(r));
    expect(carta.length).toBe(1);
    expect(valorDe(carta[0], "border-color")).toBe("var(--carta-border)");
  });
});
