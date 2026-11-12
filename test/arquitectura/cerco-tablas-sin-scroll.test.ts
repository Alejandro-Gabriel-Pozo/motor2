import { describe, expect, it } from "vitest";
import { medirPorArchivo, type Cerco } from "./cercos/trinquete";
import { probarCerco } from "./cercos/probar-cerco";

/**
 * Cerco «tablas sin scroll» (paso 7 de la auditoría 2026-11-12; regla del dueño «mobile first», 2026-11-12): una `<table>` escrita a mano que no está dentro de un contenedor con scroll horizontal
 * (`overflow-x-auto`) se sale por la derecha en un celular de 375 px y arrastra la página entera (así quedaron rotas Usuarios y Sucursales). La pieza del sistema, `TablaDeDatos`
 * (`src/ui/componentes/datos/tabla-de-datos.tsx`), ya resuelve el celular con tarjetas: por eso queda fuera. Cuenta, en `src`, cada `<table` que NO tiene `overflow-x-auto` ni `<CajaDesplazable` en los 160 caracteres
 * anteriores (el contenedor que la envuelve). La línea de base es lo que ya existía y solo baja; una tabla nueva sin contenedor falla. Se cierra migrando la tabla a
 * `TablaDeDatos` (etapas E-B…E-G de `docs/diseno-estructura-de-pantalla-1366x768-2026-11-09.md`) o envolviéndola.
 * LÍMITES: mira los 160 caracteres anteriores a la etiqueta, no el árbol: un contenedor con scroll más lejos (o puesto por otro componente) cuenta como «sin scroll»; una tabla dentro de un `overflow-x-auto`
 * que no es el suyo, también pasa. Es una alarma para errores honestos, no una medición de pantalla (el barrido a 375 px con aserción de desborde sigue siendo trabajo aparte).
 */
const PIEZA_DE_LA_TABLA = "src/ui/componentes/datos/tabla-de-datos.tsx";
const VENTANA = 160;

export function contarTablasSinScroll(fuente: string): number {
  let sinScroll = 0;
  for (const m of fuente.matchAll(/<table[\s>]/g)) {
    const antes = fuente.slice(Math.max(0, m.index - VENTANA), m.index);
    if (!/overflow-x-auto|<CajaDesplazable/.test(antes)) sinScroll++;
  }
  return sinScroll;
}

const CERCO_TABLAS_SIN_SCROLL: Cerco = {
  regla: "tablas-sin-scroll",
  meta: "0: toda tabla escrita a mano va dentro de un contenedor con scroll horizontal, o se migra a TablaDeDatos",
  medir: medirPorArchivo({
    raices: ["src"],
    extensiones: [".tsx"],
    incluir: (ruta) => ruta !== PIEZA_DE_LA_TABLA,
    contar: (fuente) => ({ "tabla-sin-scroll": contarTablasSinScroll(fuente) }),
  }),
  excepciones: [
    {
      ruta: "src/components/carta-publica/seccion.tsx",
      motivo: "La tabla de precios de la carta pública es `table-fixed` con a lo sumo 3 columnas de precio y se mide a 375 px en las pruebas de la carta (`movil-carta`, `carta-publica-*`): no se sale por la derecha.",
    },
  ],
};

describe("cerco «tablas sin scroll»: el detector", () => {
  it("no cuenta una tabla envuelta en overflow-x-auto", () => {
    expect(contarTablasSinScroll('<div className="overflow-x-auto"><table className="w-full"><tr/></table></div>')).toBe(0);
  });

  it("cuenta una tabla suelta y una de dos que no está envuelta", () => {
    expect(contarTablasSinScroll('<section><table className="w-full"></table></section>')).toBe(1);
    expect(contarTablasSinScroll('<div className="overflow-x-auto"><table></table></div>' + "x".repeat(200) + "<table>")).toBe(1);
  });

  it("no cuenta una tabla dentro de CajaDesplazable (la pieza que ya trae scroll, región y foco)", () => {
    expect(contarTablasSinScroll('<CajaDesplazable etiqueta="Tabla de insumos">\n  <table className="w-full">')).toBe(0);
  });

  it("no confunde otras etiquetas que empiezan igual", () => {
    expect(contarTablasSinScroll('<TablaDeDatos titulo="x" /> <tableau>')).toBe(0);
  });
});

probarCerco(CERCO_TABLAS_SIN_SCROLL);
