import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// El panel es un componente de cliente: fuera de Next no hay router ni se llama a ninguna acción de servidor. Esta prueba mide solo lo que DIBUJA.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

import { OPCIONES_AGOTADAS_AYUDAS_VISIBLES } from "../../src/core/catalogo/public";
import { OpcionesAgotadas, type GrupoParaAgotar } from "../../src/app/(app)/movimientos/opciones-agotadas/opciones-agotadas";

/**
 * Interruptor de los textos explicativos de «Opciones agotadas» (`OPCIONES_AGOTADAS_AYUDAS_VISIBLES`, `src/core/catalogo/opciones-agotadas-ayudas-visibles.ts`; dueño, 2026-11-16, paso 3), lado de la LISTA: apagado (hoy) el título de
 * cada grupo no trae «· N de M disponibles», pero SÍ el nombre del grupo y cada botón «Disponible/Agotada»; encendido, vuelve el conteo (reversibilidad). El párrafo de la página lo cubre el e2e (es una página de servidor).
 */
const GRUPOS: GrupoParaAgotar[] = [
  {
    grupoId: "g1",
    nombre: "Guarnición",
    opciones: [
      { opcionId: "o1", nombre: "Papas fritas", esNinguna: false, agotada: false, sinStockEnElSistema: [] },
      { opcionId: "o2", nombre: "Ensalada", esNinguna: false, agotada: true, sinStockEnElSistema: [] },
    ],
  },
];
const dibujar = (Panel: typeof OpcionesAgotadas) => renderToStaticMarkup(<Panel grupos={GRUPOS} puedeCambiar accion={async () => ({ ok: true, mensaje: "" })} />);

describe("Opciones agotadas: textos explicativos OCULTOS", () => {
  it("el interruptor está apagado: sin conteo por grupo, con el grupo y los botones", () => {
    expect(OPCIONES_AGOTADAS_AYUDAS_VISIBLES).toBe(false);
    const html = dibujar(OpcionesAgotadas);
    expect(html).not.toContain("disponibles");
    expect(html).toContain("Guarnición");
    expect(html).toContain("Papas fritas");
    expect(html).toContain("Agotada");
    expect(html).toContain("Disponible");
  });
});

describe("Opciones agotadas: textos explicativos ENCENDIDOS (reversibilidad)", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/catalogo/opciones-agotadas-ayudas-visibles");
    vi.resetModules();
  });

  it("con el interruptor en true vuelve «1 de 2 disponibles»", async () => {
    vi.resetModules();
    vi.doMock("../../src/core/catalogo/opciones-agotadas-ayudas-visibles", () => ({ OPCIONES_AGOTADAS_AYUDAS_VISIBLES: true }));
    const { OpcionesAgotadas: Encendido } = await import("../../src/app/(app)/movimientos/opciones-agotadas/opciones-agotadas");
    expect(dibujar(Encendido)).toContain("1 de 2 disponibles");
  });
});
