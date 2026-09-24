import { describe, expect, it } from "vitest";
import { resolveHeroInk, resolvePrimaryForeground, sanitizeCssColor } from "../../src/core/carta/color-css";

/**
 * Paridad de src/core/carta/color-css.ts con restaurant-menu-design/lib/hero-utils.ts (docs/plan-tema-carta-2026-09-24.md, M2,
 * D8): es una copia literal, y la carta vuelve a sanear cada color que le llega de motor2 con su propia copia. Si las dos
 * divergieran, motor2 podría aceptar un color que la carta después descarta (o al revés).
 *
 * Las salidas esperadas de estas tablas se obtuvieron corriendo la función ORIGINAL de restaurant-menu-design (commit f4529ce)
 * sobre las mismas entradas: un cambio en cualquiera de las dos copias tiene que actualizar la otra y esta tabla.
 */

const CLARO = "oklch(0.96 0.005 80)";
const OSCURO = "oklch(0.18 0.02 40)";

describe("sanitizeCssColor / resolveHeroInk: tabla de paridad con la carta", () => {
  // [entrada, sanitizeCssColor, resolveHeroInk]
  const ACEPTADOS: [string, string, string][] = [
    ["#abc", "#abc", "#abc"],
    ["#abcd", "#abcd", "#abcd"],
    ["#8B4513", "#8B4513", "#8B4513"],
    ["#8b4513cc", "#8b4513cc", "#8b4513cc"],
    ["  #fff  ", "#fff", "#fff"],
    ["rgb(255, 0, 0)", "rgb(255, 0, 0)", "rgb(255, 0, 0)"],
    ["rgba(0,0,0,0.5)", "rgba(0,0,0,0.5)", "rgba(0,0,0,0.5)"],
    ["rgb(10 20 30 / 50%)", "rgb(10 20 30 / 50%)", "rgb(10 20 30 / 50%)"],
    ["hsl(120, 50%, 50%)", "hsl(120, 50%, 50%)", "hsl(120, 50%, 50%)"],
    ["hsla(120 50% 50% / 0.3)", "hsla(120 50% 50% / 0.3)", "hsla(120 50% 50% / 0.3)"],
    ["oklch(0.76 0.14 80)", "oklch(0.76 0.14 80)", "oklch(0.76 0.14 80)"],
    ["oklab(0.5 0.1 0.1)", "oklab(0.5 0.1 0.1)", "oklab(0.5 0.1 0.1)"],
    ["color(display-p3 1 0 0)", "color(display-p3 1 0 0)", "color(display-p3 1 0 0)"],
    ["red", "red", "red"],
    ["transparent", "transparent", "transparent"],
    ["currentColor", "currentColor", "currentColor"],
    // Alias: sanitizeCssColor los deja pasar tal cual (en cualquier clave: por eso motor2 los restringe a hero_ink, D8);
    // resolveHeroInk los traduce.
    ["claro", "claro", CLARO],
    ["Oscuro", "Oscuro", OSCURO],
  ];

  it.each(ACEPTADOS)("acepta %j", (entrada, sanitizado, tinta) => {
    expect(sanitizeCssColor(entrada)).toBe(sanitizado);
    expect(resolveHeroInk(entrada)).toBe(tinta);
  });

  const RECHAZADOS = [
    "",
    "#ab",
    "#abcdefabc",
    "red;background:x",
    "rgb(1,2,3);x:y",
    "red{",
    "}",
    "<b>",
    "a>b",
    '"red"',
    "'red'",
    "red\\9",
    "url(x)",
    "</style>",
    "var(--x)",
    "12px",
    "light blue",
    "calc(1px)",
  ];

  it.each(RECHAZADOS)("rechaza %j", (entrada) => {
    expect(sanitizeCssColor(entrada)).toBeNull();
    expect(resolveHeroInk(entrada)).toBeNull();
  });
});

describe("resolvePrimaryForeground: tabla de paridad con la carta", () => {
  const CASOS: [string, string | null][] = [
    ["#000", CLARO],
    ["#fff", OSCURO],
    ["#FFFFFF", OSCURO],
    ["#8B4513", CLARO],
    ["rgb(255, 255, 255)", OSCURO],
    ["hsl(0, 0%, 0%)", CLARO],
    // oklch: el ámbar por defecto de la carta es claro (texto oscuro encima); un azul muy oscuro, al revés.
    ["oklch(0.76 0.14 80)", OSCURO],
    ["oklch(0.2 0.05 250)", CLARO],
    // Formatos que no parsea: null → la carta usa el valor de globals.css.
    ["red", null],
    ["color(display-p3 1 0 0)", null],
    ["", null],
  ];

  it.each(CASOS)("%j → %j", (color, esperado) => {
    expect(resolvePrimaryForeground(color)).toBe(esperado);
  });
});
