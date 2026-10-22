import { describe, expect, it } from "vitest";
import { contarCoincidencias, medirPorArchivo, sinComentarios, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «modo oscuro» (ola «precio y carta», Fase 1; DEC-04 del dueño: sin modo oscuro en NINGUNA parte, también la carta del
 * administrador que había aprobado ADR-034). Meta: 0 en la Fase 6, que borra todo esto de una vez y declara `color-scheme: light`.
 *
 * Cuenta, en `src/` y en la consola de plataforma (`plataforma/src/`), fuera de los comentarios:
 *  - `dark:` — cada variante oscura de Tailwind en una clase (`dark:bg-neutral-900`, `dark:hover:text-white`, `dark:[&>a]:…`);
 *  - `prefers-color-scheme` — cada consulta al tema del sistema (`@media (prefers-color-scheme: dark)` o un `matchMedia`);
 *  - `color-scheme-oscuro` — cada `color-scheme` / `colorScheme` que admite el oscuro (`light dark`, `dark`): los controles nativos
 *    (campos, barras de desplazamiento) se oscurecen según el sistema aunque la página no tenga reglas oscuras.
 * `color-scheme: light` a secas NO cuenta: es justo lo que se quiere.
 *
 * Mecanismo, regeneración (`BAJAR_CERCOS=1`) y excepciones: `test/arquitectura/cercos/trinquete.ts`.
 */
const RE_VARIANTE_OSCURA = /(?<![\w-])dark:(?=[\w[!&@*-])/g;
const RE_PREFERS = /prefers-color-scheme/g;
const RE_COLOR_SCHEME_OSCURO = /(?<![\w-])(?:color-scheme|colorScheme)["'`]?\s*:\s*["'`]?\s*(?:light\s+)?dark\b/g;

function contarModoOscuro(fuente: string): Record<string, number> {
  return {
    "dark:": contarCoincidencias(fuente, RE_VARIANTE_OSCURA),
    "prefers-color-scheme": contarCoincidencias(fuente, RE_PREFERS),
    "color-scheme-oscuro": contarCoincidencias(fuente, RE_COLOR_SCHEME_OSCURO),
  };
}

const CERCO_MODO_OSCURO: Cerco = {
  regla: "modo-oscuro",
  meta: "0 en la Fase 6 (DEC-04: sin modo oscuro en ninguna parte; la raíz declara color-scheme: light)",
  medir: medirPorArchivo({ raices: ["src", "plataforma/src"], extensiones: [".ts", ".tsx", ".css"], contar: contarModoOscuro }),
};

describe("cerco «modo oscuro»: el detector", () => {
  const contar = (fuente: string, ruta = "x.tsx") => contarModoOscuro(sinComentarios(fuente, ruta));

  it("cuenta cada variante dark: de una clase (también encadenada o arbitraria) y no la palabra suelta ni un comentario", () => {
    expect(contar('<p className="text-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800 md:dark:[&>a]:underline">x</p>')["dark:"]).toBe(3);
    expect(contar('const c = "border dark:border-neutral-700";')["dark:"]).toBe(1);
    expect(contar("// antes: dark:bg-neutral-900\nconst modo = { dark: true };")["dark:"]).toBe(0);
    expect(contar('<p className="bg-dark:x">x</p>')["dark:"]).toBe(0);
  });

  it("cuenta prefers-color-scheme y color-scheme que admite el oscuro, no color-scheme: light ni un comentario", () => {
    const css = [":root { color-scheme: light dark; }", "@media (prefers-color-scheme: dark) { :root { --x: 1; } }", ".a { color-scheme: light; }", "/* color-scheme: light dark */"].join("\n");
    expect(contar(css, "x.css")).toEqual({ "dark:": 0, "prefers-color-scheme": 1, "color-scheme-oscuro": 1 });
    expect(contar('const s = { colorScheme: "dark" }; matchMedia("(prefers-color-scheme: dark)");', "x.ts")).toEqual({ "dark:": 0, "prefers-color-scheme": 1, "color-scheme-oscuro": 1 });
  });
});

probarCerco(CERCO_MODO_OSCURO);
