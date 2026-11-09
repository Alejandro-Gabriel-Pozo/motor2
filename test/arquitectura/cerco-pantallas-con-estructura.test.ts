import { describe, expect, it } from "vitest";
import { medirPorArchivo, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «pantallas con estructura» (docs/diseno-estructura-de-pantalla-1366x768-2026-11-09.md, §11): el estándar de distribución de pantalla (`src/ui/componentes/estructura/`) se
 * aplica pantalla por pantalla, por etapas (E-A…E-H). Cuenta cada `page.tsx` de `src/app/(app)` y `src/app/(pos)` que TODAVÍA no lo usa: la línea de base es esa lista y solo baja.
 * Una pantalla nueva sin el estándar falla (lo nuevo no entra); una pantalla que se adopta hace bajar la línea de base (`BAJAR_CERCOS=1`).
 *
 * «Usa el estándar» = importa alguna pieza de `@/ui/componentes/estructura/` o abre el marco del espacio del producto con `ancho="ancho"` (el marco ancho es la pieza que reparte
 * el ancho para sus pantallas). El shell común (`AppShell`) ya aplica el contenedor y el área que se desplaza a TODAS las pantallas: lo que se cuenta acá es la distribución propia
 * de cada una (rejilla, encabezado fijo, barra de acciones).
 *
 * Mecanismo, regeneración y excepciones: `test/arquitectura/cercos/trinquete.ts`. Meta: 0 al terminar E-H.
 */
const RUTA_DE_PANTALLA = /^src\/app\/\((app|pos)\)\/.*page\.tsx$/;

export function usaElEstandarDePantalla(fuente: string): boolean {
  return /from\s+["']@\/ui\/componentes\/estructura\//.test(fuente) || /ancho=["']ancho["']/.test(fuente);
}

function contarPantallaSinEstandar(fuente: string): Record<string, number> {
  return { "sin-estructura": usaElEstandarDePantalla(fuente) ? 0 : 1 };
}

const CERCO_PANTALLAS: Cerco = {
  regla: "pantallas-con-estructura",
  meta: "bajar a 0 al terminar la etapa E-H: toda pantalla de (app) y (pos) usa las piezas de src/ui/componentes/estructura",
  medir: medirPorArchivo({ raices: ["src/app"], extensiones: [".tsx"], incluir: (ruta) => RUTA_DE_PANTALLA.test(ruta), contar: contarPantallaSinEstandar }),
};

describe("cerco «pantallas con estructura»: el detector", () => {
  it("una pantalla que importa una pieza del estándar está adoptada", () => {
    expect(usaElEstandarDePantalla('import { RejillaDeSecciones } from "@/ui/componentes/estructura/rejilla-de-secciones";')).toBe(true);
  });

  it("una que abre el marco con ancho=\"ancho\" está adoptada", () => {
    expect(usaElEstandarDePantalla('<MarcoDelEspacio actual="receta" ancho="ancho">')).toBe(true);
  });

  it("una pantalla sin nada de eso, o con el marco angosto, no lo está", () => {
    expect(usaElEstandarDePantalla('import { Aviso } from "@/ui/primitivas/aviso"; <MarcoDelEspacio actual="datos">')).toBe(false);
  });

  it("solo cuenta pantallas de (app) y (pos)", () => {
    expect(RUTA_DE_PANTALLA.test("src/app/(app)/catalogo/productos/page.tsx")).toBe(true);
    expect(RUTA_DE_PANTALLA.test("src/app/(pos)/mesas/page.tsx")).toBe(true);
    expect(RUTA_DE_PANTALLA.test("src/app/(carta-publica)/carta-publica/[empresa]/page.tsx")).toBe(false);
    expect(RUTA_DE_PANTALLA.test("src/app/login/page.tsx")).toBe(false);
  });
});

probarCerco(CERCO_PANTALLAS);
