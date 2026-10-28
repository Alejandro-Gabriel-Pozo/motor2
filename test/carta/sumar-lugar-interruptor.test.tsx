import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MENU_DEL_DIA_VISIBLE, SUMAR_LUGAR_DE_LISTA_VISIBLE, type LugarDeCombo } from "../../src/core/carta/public";
import { CamposLugares } from "../../src/app/(app)/carta/parametrizacion/formularios";

/**
 * Interruptor de «Sumar un lugar» de lista (`SUMAR_LUGAR_DE_LISTA_VISIBLE`, `src/core/carta/cupos-de-promo.ts`; decisión del dueño 2026-10-28: «es algo obsoleto, es más fácil agregar la sección del otro
 * lado y tildarla»; docs/diseno-modulo-carta-2026-10-28.md). Solo cambia la PANTALLA (el servidor y lo guardado no se tocan). Fija los DOS estados:
 *  - APAGADO (hoy): el formulario de cupos no ofrece sumar un lugar nuevo (ni el tipo, ni el nombre, ni mín./máx.); un lugar de lista que ya existía se sigue mostrando con su casilla y sus cantidades.
 *  - ENCENDIDO (reversibilidad: cargando el módulo con el interruptor en `true`): vuelve la fila «Sumar un lugar» con «Lista de productos».
 */
const LUGARES: LugarDeCombo[] = [{ id: "l1", tipo: "LISTA", nombre: "Bebida", cantidadMinima: 1, cantidadMaxima: 1, orden: 1, entradas: [] }];
const dibujar = (Campos: typeof CamposLugares) => renderToStaticMarkup(<Campos lugares={LUGARES} />);

describe("«Sumar un lugar» APAGADO (decisión del dueño 2026-10-28)", () => {
  it("el interruptor está apagado (y el del menú del día también: con los dos apagados no hay ningún tipo que ofrecer)", () => {
    expect(SUMAR_LUGAR_DE_LISTA_VISIBLE).toBe(false);
    expect(MENU_DEL_DIA_VISIBLE).toBe(false);
  });

  it("el formulario no ofrece sumar un lugar nuevo, pero el lugar de lista que ya existía se sigue mostrando y editando", () => {
    const html = dibujar(CamposLugares);
    expect(html).not.toContain("Sumar un lugar");
    for (const campo of ["nuevo_lugar_tipo", "nuevo_lugar_nombre", "nuevo_lugar_min", "nuevo_lugar_max"]) expect(html, campo).not.toContain(`name="${campo}"`);
    expect(html).toContain('data-cupo-lugar="Bebida"');
    expect(html).toContain('name="lugar_incluir_l1"');
    expect(html).toContain('name="lugar_min_l1"');
    expect(html).toContain('name="lugar_max_l1"');
  });
});

describe("«Sumar un lugar» ENCENDIDO (reversibilidad)", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/carta/cupos-de-promo");
    vi.resetModules();
  });

  it("vuelve la fila «Sumar un lugar» con «Lista de productos», su nombre y sus cantidades", async () => {
    vi.resetModules();
    vi.doMock("../../src/core/carta/cupos-de-promo", async (original) => ({ ...(await original<typeof import("../../src/core/carta/cupos-de-promo")>()), SUMAR_LUGAR_DE_LISTA_VISIBLE: true }));
    const html = dibujar((await import("../../src/app/(app)/carta/parametrizacion/formularios")).CamposLugares);
    expect(html).toContain("Sumar un lugar (opcional)");
    expect(html).toContain('<option value="LISTA" selected="">Lista de productos</option>');
    for (const campo of ["nuevo_lugar_tipo", "nuevo_lugar_nombre", "nuevo_lugar_min", "nuevo_lugar_max"]) expect(html, campo).toContain(`name="${campo}"`);
  });
});
