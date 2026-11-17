import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// El panel es un componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. Esta prueba mide solo lo que DIBUJA.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

import type { GrupoParaAgotar } from "../../src/app/(app)/movimientos/opciones-agotadas/opciones-agotadas";

/**
 * Interruptor de la vista plegada de «Opciones agotadas» (`OPCIONES_AGOTADAS_PLEGADAS`, `src/core/catalogo/opciones-agotadas-plegadas.ts`; dueño, 2026-11-16, paso 3), los DOS estados.
 * Plegado (hoy): los grupos con alguna agotada van primero y abiertos; los de todo disponible, después y plegados («todas disponibles»). Apagado: el orden del servidor y todos abiertos, como siempre.
 */
const op = (id: string, nombre: string, agotada: boolean) => ({ opcionId: id, nombre, esNinguna: false, agotada, sinStockEnElSistema: [] });
const GRUPOS: GrupoParaAgotar[] = [
  { grupoId: "ga", nombre: "Aderezos", opciones: [op("o1", "Mayonesa", false), op("o2", "Mostaza", false)] },
  { grupoId: "gb", nombre: "Bebidas", opciones: [op("o3", "Cola", true), op("o4", "Agua", false)] },
  { grupoId: "gc", nombre: "Carnes", opciones: [op("o5", "Bife", false)] },
  { grupoId: "gd", nombre: "Dulces", opciones: [op("o6", "Flan", true)] },
];

afterEach(() => {
  vi.doUnmock("../../src/core/catalogo/opciones-agotadas-plegadas");
  vi.resetModules();
});

async function dibujar(plegadas: boolean, grupos = GRUPOS) {
  vi.resetModules();
  vi.doMock("../../src/core/catalogo/opciones-agotadas-plegadas", () => ({ OPCIONES_AGOTADAS_PLEGADAS: plegadas }));
  const { OpcionesAgotadas } = await import("../../src/app/(app)/movimientos/opciones-agotadas/opciones-agotadas");
  return renderToStaticMarkup(<OpcionesAgotadas grupos={grupos} puedeCambiar accion={async () => ({ ok: true, mensaje: "" })} />);
}
const ordenDe = (html: string) => [...html.matchAll(/<h2[^>]*>([^<]+)</g)].map((m) => m[1]);

describe("Opciones agotadas: vista plegada", () => {
  it("hoy está prendida", async () => {
    expect((await import("../../src/core/catalogo/opciones-agotadas-plegadas")).OPCIONES_AGOTADAS_PLEGADAS).toBe(true);
  });

  it("las agotadas primero (en el orden del servidor entre sí) y después los de todo disponible", async () => {
    expect(ordenDe(await dibujar(true))).toEqual(["Bebidas", "Dulces", "Aderezos", "Carnes"]);
  });

  it("abiertos los que tienen agotadas, plegados los de todo disponible, con su marca", async () => {
    const html = await dibujar(true);
    const bloques = html.split("<details").slice(1);
    expect(bloques.length).toBe(4);
    expect(bloques.filter((b) => b.startsWith(" open")).length).toBe(2);
    expect(html.match(/todas disponibles/g)?.length).toBe(2);
    expect(html).toContain('data-grupo-de-opciones="Bebidas"');
  });

  it("sin ninguna agotada: todos plegados y en el orden del servidor", async () => {
    const todos = GRUPOS.map((g) => ({ ...g, opciones: g.opciones.map((o) => ({ ...o, agotada: false })) }));
    const html = await dibujar(true, todos);
    expect(ordenDe(html)).toEqual(["Aderezos", "Bebidas", "Carnes", "Dulces"]);
    expect(html).not.toContain("<details open");
  });

  it("los botones de cada opción están todos dibujados aunque el grupo esté plegado", async () => {
    const html = await dibujar(true);
    for (const n of ["Mayonesa", "Mostaza", "Cola", "Agua", "Bife", "Flan"]) expect(html).toContain(n);
  });
});

describe("Opciones agotadas: vista de siempre (apagado)", () => {
  it("todos los grupos abiertos, sin plegables, en el orden del servidor", async () => {
    const html = await dibujar(false);
    expect(ordenDe(html)).toEqual(["Aderezos", "Bebidas", "Carnes", "Dulces"]);
    expect(html).not.toContain("<details");
    expect(html).not.toContain("todas disponibles");
  });
});
