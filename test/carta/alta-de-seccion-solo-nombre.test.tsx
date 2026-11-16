import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ALTA_DE_SECCION_SOLO_NOMBRE } from "../../src/core/carta/public";
import { CamposDeAltaDeSeccion } from "../../src/app/(app)/carta/parametrizacion/formularios";

/**
 * Interruptor del alta de una sección con SOLO el nombre (`ALTA_DE_SECCION_SOLO_NOMBRE`, `src/core/carta/alta-de-seccion-solo-nombre.ts`; decisión del dueño, 2026-11-16). Solo cambia la PANTALLA. Fija los DOS estados:
 *  - ENCENDIDO (hoy): el alta pide solo el nombre; el orden lo pone la página al guardar (cae al final) y no se piden título, descripción ni imagen.
 *  - APAGADO (reversibilidad): vuelven los cinco campos de siempre, con el orden sugerido visible.
 */
const dibujar = (Campos: typeof CamposDeAltaDeSeccion) => renderToStaticMarkup(<Campos ordenSugerido={14} />);

describe("alta de sección con solo el nombre: ENCENDIDO (decisión del dueño 2026-11-16)", () => {
  it("el interruptor está encendido", () => {
    expect(ALTA_DE_SECCION_SOLO_NOMBRE).toBe(true);
  });

  it("pide solo el nombre; no ofrece título, descripción, imagen ni orden", () => {
    const html = dibujar(CamposDeAltaDeSeccion);
    expect(html).toContain('name="nombre"');
    for (const campo of ["titulo", "descripcion", "imagenUrl", "orden"]) expect(html, campo).not.toContain(`name="${campo}"`);
    expect(html).not.toContain("Título");
  });
});

describe("alta de sección con solo el nombre: APAGADO (reversibilidad)", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/carta/alta-de-seccion-solo-nombre");
    vi.resetModules();
  });

  it("con el interruptor en false vuelven los cinco campos de siempre, con el orden sugerido visible", async () => {
    vi.resetModules();
    vi.doMock("../../src/core/carta/alta-de-seccion-solo-nombre", () => ({ ALTA_DE_SECCION_SOLO_NOMBRE: false }));
    const html = dibujar((await import("../../src/app/(app)/carta/parametrizacion/formularios")).CamposDeAltaDeSeccion);
    for (const campo of ["nombre", "titulo", "descripcion", "imagenUrl", "orden"]) expect(html, campo).toContain(`name="${campo}"`);
    expect(html).toContain('inputMode="decimal"'); // el campo de orden visible (CampoNumero)
    expect(html).toContain("Título");
  });
});
