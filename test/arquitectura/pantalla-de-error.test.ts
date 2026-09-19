import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La aplicación tiene pantalla de error propia. Sin `error.tsx`, un fallo al armar una pantalla mostraba la página de error
 * genérica de Next (sin menú ni salida); `global-error.tsx` cubre la caída del layout raíz. Next 16 les pasa `retry` (reemplaza
 * a `reset`) y los dos tienen que ser componentes de cliente. Que el error se ve de verdad se comprueba en el navegador (e2e).
 */
const RAIZ = join(__dirname, "../../src/app");
const PANTALLAS = ["(app)/error.tsx", "global-error.tsx"];

describe.each(PANTALLAS)("src/app/%s", (archivo) => {
  it("existe y es un componente de cliente con «Reintentar» (retry)", () => {
    expect(existsSync(join(RAIZ, archivo))).toBe(true);
    const fuente = readFileSync(join(RAIZ, archivo), "utf8");
    expect(fuente.trimStart().startsWith('"use client"')).toBe(true);
    expect(fuente).toMatch(/retry\(\)/);
    expect(fuente).toContain("Reintentar");
  });

  it("no muestra el mensaje del error al usuario (en producción Next lo esconde; el digest es el código para los logs)", () => {
    const fuente = readFileSync(join(RAIZ, archivo), "utf8");
    expect(fuente).not.toMatch(/\{\s*error\.message\s*\}/);
    expect(fuente).toContain("error.digest");
  });
});

it("global-error trae su propio <html> y <body> (reemplaza al layout raíz)", () => {
  const fuente = readFileSync(join(RAIZ, "global-error.tsx"), "utf8");
  expect(fuente).toContain("<html");
  expect(fuente).toContain("<body");
});
