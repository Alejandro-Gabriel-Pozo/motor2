import { afterEach, describe, expect, it, vi } from "vitest";
import { PESTANAS_DE_CARTA, armarPestanasDeCarta, primeraPantallaVisible } from "../../src/core/carta/public";
import { pestanasOfrecidas } from "../../src/core/navegacion/candidatas-a-baja";
import type { AccionClave } from "../../src/core/permisos/acciones";

/**
 * Las pestañas de Carta con las candidatas a baja (Frente 6, paso 4; `CANDIDATAS_A_BAJA_VISIBLES`), los DOS estados: apagado no se ofrece «Ítems agrupados» ni «Géneros»; encendido vuelven; y a donde se redirige a quien no
 * ve la principal nunca es una pantalla oculta. Las pantallas siguen existiendo (se abren por su dirección).
 */
const TODAS = new Set<AccionClave>(PESTANAS_DE_CARTA.flatMap((p) => p.pantallas.map((x) => x.accion)));
const textos = (p: readonly { texto: string }[]) => p.map((x) => x.texto);

afterEach(() => {
  vi.doUnmock("../../src/core/navegacion/candidatas-a-baja");
  vi.resetModules();
});

describe("pestanasOfrecidas", () => {
  it("apagado: «Secciones y géneros» queda solo con Secciones y «Ítems agrupados» desaparece", () => {
    const o = pestanasOfrecidas(PESTANAS_DE_CARTA, false);
    expect(textos(o)).toEqual(["Hoy", "Secciones y géneros"]);
    expect(o.flatMap((p) => p.pantallas.map((x) => x.href))).not.toContain("/carta/parametrizacion/generos");
    expect(o.flatMap((p) => p.pantallas.map((x) => x.href))).not.toContain("/carta/agrupados");
  });
  it("encendido: las tres pestañas con todas sus pantallas, como siempre", () => {
    const o = pestanasOfrecidas(PESTANAS_DE_CARTA, true);
    expect(textos(o)).toEqual(["Hoy", "Secciones y géneros", "Ítems agrupados"]);
    expect(o).toEqual([...PESTANAS_DE_CARTA]);
  });
  it("no muta las pestañas originales", () => {
    const antes = JSON.stringify(PESTANAS_DE_CARTA);
    pestanasOfrecidas(PESTANAS_DE_CARTA, false);
    expect(JSON.stringify(PESTANAS_DE_CARTA)).toBe(antes);
  });
});

describe("a dónde se redirige a quien no ve la principal", () => {
  const soloAgrupados = new Set<AccionClave>(["carta_items_agrupados"]);
  it("apagado: quien solo ve «Ítems agrupados» no cae en una pantalla oculta (no hay a dónde)", () => {
    expect(primeraPantallaVisible(pestanasOfrecidas(PESTANAS_DE_CARTA, false), soloAgrupados)).toBeNull();
  });
  it("encendido: cae en «Ítems agrupados», como siempre", () => {
    expect(primeraPantallaVisible(pestanasOfrecidas(PESTANAS_DE_CARTA, true), soloAgrupados)).toBe("/carta/agrupados");
  });
  it("quien ve Opciones agotadas (encargado) va a esa pantalla en los dos estados", () => {
    const encargado = new Set<AccionClave>(["opcion_apagar_en_sucursal"]);
    expect(primeraPantallaVisible(pestanasOfrecidas(PESTANAS_DE_CARTA, false), encargado)).toBe("/movimientos/opciones-agotadas");
    expect(primeraPantallaVisible(pestanasOfrecidas(PESTANAS_DE_CARTA, true), encargado)).toBe("/movimientos/opciones-agotadas");
  });
});

async function cargar(visibles: boolean) {
  vi.resetModules();
  vi.doMock("../../src/core/navegacion/candidatas-a-baja", async (importOriginal) => {
    const real = await importOriginal<typeof import("../../src/core/navegacion/candidatas-a-baja")>();
    return { ...real, CANDIDATAS_A_BAJA_VISIBLES: visibles, rutaOfrecida: (h: string) => real.rutaOfrecida(h, visibles), pestanasOfrecidas: <P extends { pantallas: readonly { href: string }[] }>(p: readonly P[]) => real.pestanasOfrecidas(p, visibles) };
  });
  return import("../../src/server/acceso/menu");
}

describe("la fila de pestañas que arma el servidor (pestanasVisiblesDeCarta)", () => {
  const ctx = {} as never; // con `visibles` dado no se consulta nada
  it("apagado: dos pestañas; en «Géneros» (abierta por su dirección) queda marcada «Secciones y géneros»", async () => {
    const { pestanasVisiblesDeCarta } = await cargar(false);
    const enGeneros = await pestanasVisiblesDeCarta(ctx, PESTANAS_DE_CARTA, "/carta/parametrizacion/generos", TODAS);
    expect(textos(enGeneros)).toEqual(["Hoy", "Secciones y géneros"]);
    expect(enGeneros.filter((p) => p.actual).map((p) => p.texto)).toEqual(["Secciones y géneros"]);
  });
  it("apagado: en «Ítems agrupados» (abierta por su dirección) no hay pestaña marcada, porque se ocultó entera (diferencia declarada)", async () => {
    const { pestanasVisiblesDeCarta } = await cargar(false);
    const enAgrupados = await pestanasVisiblesDeCarta(ctx, PESTANAS_DE_CARTA, "/carta/agrupados", TODAS);
    expect(enAgrupados.some((p) => p.actual)).toBe(false);
  });
  it("encendido: las tres pestañas y la de «Ítems agrupados» marcada en su pantalla, como siempre", async () => {
    const { pestanasVisiblesDeCarta } = await cargar(true);
    const enAgrupados = await pestanasVisiblesDeCarta(ctx, PESTANAS_DE_CARTA, "/carta/agrupados", TODAS);
    expect(textos(enAgrupados)).toEqual(["Hoy", "Secciones y géneros", "Ítems agrupados"]);
    expect(enAgrupados.filter((p) => p.actual).map((p) => p.texto)).toEqual(["Ítems agrupados"]);
    expect(enAgrupados).toEqual(armarPestanasDeCarta(PESTANAS_DE_CARTA, TODAS, "/carta/agrupados"));
  });
});
