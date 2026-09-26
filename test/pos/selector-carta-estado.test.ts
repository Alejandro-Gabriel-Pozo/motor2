import { describe, expect, it } from "vitest";
import { SECCION_FUERA_DE_CARTA, estadoInicialSelectorCarta, reducirSelectorCarta, type AccionSelectorCarta, type EstadoSelectorCarta } from "../../src/core/pos/selector-carta-estado";
import type { ProductoPedible, SelectorCartaPos } from "../../src/core/pos/selector-carta";

/**
 * Estado de NAVEGACIÓN del selector por sección de carta del POS (docs/plan-selector-carta-pos-2026-09-25.md, paso 3;
 * docs/plan-pos-agregar-varios-2026-09-26.md): reductor puro, sin DOM. Qué está EN LA LISTA para agregar es un reductor aparte
 * (test/pos/agregar-lista-estado.test.ts) — acá solo qué sección/agrupado/carpeta está a la vista.
 */

const pedible = (productoId: string): ProductoPedible => ({ productoId, codigo: productoId, nombre: productoId, precio: 1, decimales: 0 });

const selector: SelectorCartaPos = {
  seccionesCarta: [
    { seccionCartaId: "s-platos", nombre: "Platos", entradas: [{ tipo: "producto", producto: pedible("p-bife") }] },
    {
      seccionCartaId: "s-bebidas",
      nombre: "Bebidas",
      entradas: [
        { tipo: "agrupado", itemAgrupadoCartaId: "ag-gaseosa", nombre: "Gaseosa", precioMinimo: 1, precioMaximo: 1, opciones: [pedible("p-coca"), pedible("p-sprite")] },
        { tipo: "agrupado", itemAgrupadoCartaId: "ag-agua", nombre: "Agua", precioMinimo: 1, precioMaximo: 1, opciones: [pedible("p-agua")] },
      ],
    },
  ],
  fueraDeCarta: [pedible("p-flan")],
};

const aplicar = (estado: EstadoSelectorCarta, ...acciones: AccionSelectorCarta[]) => acciones.reduce(reducirSelectorCarta, estado);

describe("estado del selector por sección de carta", () => {
  const inicial = estadoInicialSelectorCarta(selector);

  it("arranca en la primera sección de carta, sin agrupado ni carpeta abiertos", () => {
    expect(inicial).toEqual({ seccionActiva: "s-platos", agrupadoAbierto: null, carpetaAbierta: null, limpiarBuscador: 0 });
  });

  it("sin secciones de carta arranca en «Fuera de carta»; sin nada que navegar, en ninguna", () => {
    expect(estadoInicialSelectorCarta({ seccionesCarta: [], fueraDeCarta: [pedible("p-flan")] }).seccionActiva).toBe(SECCION_FUERA_DE_CARTA);
    expect(estadoInicialSelectorCarta({ seccionesCarta: [], fueraDeCarta: [] }).seccionActiva).toBeNull();
    expect(estadoInicialSelectorCarta(null).seccionActiva).toBeNull();
  });

  it("cambiar de sección cierra el agrupado desplegado", () => {
    const e = aplicar(inicial, { tipo: "elegirSeccion", seccionId: "s-bebidas" }, { tipo: "alternarAgrupado", itemAgrupadoCartaId: "ag-gaseosa" }, { tipo: "elegirSeccion", seccionId: SECCION_FUERA_DE_CARTA });
    expect(e).toMatchObject({ seccionActiva: SECCION_FUERA_DE_CARTA, agrupadoAbierto: null });
  });

  it("abrir otro agrupado cierra el anterior; volver a tocar el mismo lo cierra", () => {
    const abierto = aplicar(inicial, { tipo: "alternarAgrupado", itemAgrupadoCartaId: "ag-gaseosa" });
    expect(abierto.agrupadoAbierto).toBe("ag-gaseosa");
    const otro = aplicar(abierto, { tipo: "alternarAgrupado", itemAgrupadoCartaId: "ag-agua" });
    expect(otro.agrupadoAbierto).toBe("ag-agua");
    expect(aplicar(otro, { tipo: "alternarAgrupado", itemAgrupadoCartaId: "ag-agua" }).agrupadoAbierto).toBeNull();
  });

  it("sumar un producto vacía el buscador y cierra el agrupado suelto desplegado, quedando en la sección activa", () => {
    const e = aplicar(inicial, { tipo: "elegirSeccion", seccionId: "s-bebidas" }, { tipo: "alternarAgrupado", itemAgrupadoCartaId: "ag-gaseosa" }, { tipo: "productoSumado" });
    expect(e).toEqual({ seccionActiva: "s-bebidas", agrupadoAbierto: null, carpetaAbierta: null, limpiarBuscador: 1 });
  });

  it("carpeta de género: abrir una cierra la anterior y el agrupado suelto que estuviera abierto; volver a tocar la misma la cierra", () => {
    const conAgrupado = aplicar(inicial, { tipo: "elegirSeccion", seccionId: "s-bebidas" }, { tipo: "alternarAgrupado", itemAgrupadoCartaId: "ag-gaseosa" });
    const abierta = aplicar(conAgrupado, { tipo: "alternarCarpeta", generoCartaId: "gen-cerveza" });
    expect(abierta).toMatchObject({ carpetaAbierta: "gen-cerveza", agrupadoAbierto: null });
    const otra = aplicar(abierta, { tipo: "alternarCarpeta", generoCartaId: "gen-vino" });
    expect(otra.carpetaAbierta).toBe("gen-vino");
    expect(aplicar(otra, { tipo: "alternarCarpeta", generoCartaId: "gen-vino" }).carpetaAbierta).toBeNull();
  });

  it("abrir un agrupado suelto cierra la carpeta abierta", () => {
    const conCarpeta = aplicar(inicial, { tipo: "alternarCarpeta", generoCartaId: "gen-cerveza" });
    expect(conCarpeta.carpetaAbierta).toBe("gen-cerveza");
    const e = aplicar(conCarpeta, { tipo: "alternarAgrupado", itemAgrupadoCartaId: "ag-gaseosa" });
    expect(e).toMatchObject({ agrupadoAbierto: "ag-gaseosa", carpetaAbierta: null });
  });

  it("sumar un producto: la carpeta abierta QUEDA abierta (G3, pedir varios de adentro sin reabrir); el agrupado suelto se cierra igual que siempre", () => {
    const e = aplicar(inicial, { tipo: "alternarCarpeta", generoCartaId: "gen-cerveza" }, { tipo: "productoSumado" });
    expect(e).toMatchObject({ carpetaAbierta: "gen-cerveza", agrupadoAbierto: null });
  });

  it("cambiar de sección cierra también la carpeta de género abierta", () => {
    const e = aplicar(inicial, { tipo: "alternarCarpeta", generoCartaId: "gen-cerveza" }, { tipo: "elegirSeccion", seccionId: "s-bebidas" });
    expect(e.carpetaAbierta).toBeNull();
  });
});
