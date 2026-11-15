import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUMAR_LUGAR_DE_LISTA_VISIBLE, type LugarDeCombo } from "../../src/core/carta/public";
import { CamposLugares } from "../../src/app/(app)/carta/parametrizacion/formularios";

/**
 * Interruptor de «Sumar un lugar» de lista (`SUMAR_LUGAR_DE_LISTA_VISIBLE`, `src/core/carta/cupos-de-promo.ts`). Apagado el 2026-10-28 («es algo obsoleto»); PRENDIDO el 2026-11-11 por decisión del dueño
 * (pedido del «Menú ejecutivo»: el mozo elige el plato con tamaño dentro de un lugar de lista). Solo cambia la PANTALLA (el servidor y lo guardado no se tocan). Fija los DOS estados:
 *  - ENCENDIDO (hoy): el formulario de cupos ofrece «Sumar un lugar» con «Lista de productos», su nombre y sus cantidades; un lugar existente se sigue mostrando con su casilla y sus cantidades.
 *  - APAGADO (reversibilidad: cargando el módulo con el interruptor en `false`): no se ofrece sumar un lugar nuevo.
 */
const LUGARES: LugarDeCombo[] = [{ id: "l1", tipo: "LISTA", nombre: "Bebida", cantidadMinima: 1, cantidadMaxima: 1, orden: 1, entradas: [] }];
const dibujar = (Campos: typeof CamposLugares) => renderToStaticMarkup(<Campos lugares={LUGARES} />);

describe("«Sumar un lugar» ENCENDIDO (decisión del dueño 2026-11-11)", () => {
  it("el interruptor está encendido", () => {
    expect(SUMAR_LUGAR_DE_LISTA_VISIBLE).toBe(true);
  });

  it("el formulario ofrece sumar un lugar de lista (solo ese tipo) y el lugar que ya existía se sigue mostrando y editando", () => {
    const html = dibujar(CamposLugares);
    expect(html).toContain("Sumar un lugar (opcional)");
    expect(html).toContain('<option value="LISTA" selected="">Lista de productos</option>');
    expect(html).not.toContain('<option value="DEL_DIA"');
    for (const campo of ["nuevo_lugar_tipo", "nuevo_lugar_nombre", "nuevo_lugar_min", "nuevo_lugar_max"]) expect(html, campo).toContain(`name="${campo}"`);
    expect(html).toContain('data-cupo-lugar="Bebida"');
    expect(html).toContain('name="lugar_incluir_l1"');
    expect(html).toContain('name="lugar_min_l1"');
    expect(html).toContain('name="lugar_max_l1"');
  });
});

describe("«Sumar un lugar» APAGADO (reversibilidad)", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/carta/cupos-de-promo");
    vi.resetModules();
  });

  it("con el interruptor en false vuelve a no ofrecerse, pero el lugar existente se sigue mostrando", async () => {
    vi.resetModules();
    vi.doMock("../../src/core/carta/cupos-de-promo", async (original) => ({ ...(await original<typeof import("../../src/core/carta/cupos-de-promo")>()), SUMAR_LUGAR_DE_LISTA_VISIBLE: false }));
    const html = dibujar((await import("../../src/app/(app)/carta/parametrizacion/formularios")).CamposLugares);
    expect(html).not.toContain("Sumar un lugar");
    for (const campo of ["nuevo_lugar_tipo", "nuevo_lugar_nombre", "nuevo_lugar_min", "nuevo_lugar_max"]) expect(html, campo).not.toContain(`name="${campo}"`);
    expect(html).toContain('data-cupo-lugar="Bebida"');
  });
});
