import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VIGENCIA_DE_PROMO_VISIBLE, type VigenciaDePromoAdmin } from "../../src/core/carta/public";
import { BloqueDeVigencia } from "../../src/app/(app)/carta/parametrizacion/formularios";

/**
 * Interruptor de la VIGENCIA en la pantalla de las promos (`VIGENCIA_DE_PROMO_VISIBLE`, `src/core/carta/vigencia-de-promo.ts`; decisión del dueño del 2026-10-20, 10.ª y 11.ª parte de
 * docs/pendientes-sesion-2026-10-22.md: la promo no tiene vigencia ni días, se maneja con activar/desactivar). Solo cambia la PANTALLA (servidor, columnas y filtro del POS, intactos). Fija los DOS estados:
 *  - APAGADO (hoy): no se dibuja el bloque (ni «Desde», ni «Hasta», ni «Días en que vale», ni «Guardar vigencia»); si una promo trae una vigencia cargada de antes, se la nombra como texto (el POS la sigue
 *    respetando: no se esconde una regla que decide qué se vende).
 *  - ENCENDIDO (reversibilidad): vuelve el título y el formulario (para quien edita) o el texto (para quien solo ve).
 */
const SIN: VigenciaDePromoAdmin = { version: 1, vigenteDesde: null, vigenteHasta: null, diasDeSemana: null };
const DE_ANTES: VigenciaDePromoAdmin = { version: 3, vigenteDesde: null, vigenteHasta: null, diasDeSemana: 31 };
const FORMULARIO = <form data-formulario-de-vigencia="">Guardar vigencia</form>;
const dibujar = (Bloque: typeof BloqueDeVigencia, vigencia: VigenciaDePromoAdmin, puedeEditar = true) =>
  renderToStaticMarkup(
    <Bloque vigencia={vigencia} puedeEditar={puedeEditar}>
      {FORMULARIO}
    </Bloque>
  );

describe("vigencia de la promo APAGADA en la pantalla (decisión del dueño)", () => {
  it("el interruptor está apagado", () => {
    expect(VIGENCIA_DE_PROMO_VISIBLE).toBe(false);
  });

  it("sin vigencia cargada no se dibuja nada: ni el título, ni el formulario", () => {
    expect(dibujar(BloqueDeVigencia, SIN)).toBe("");
    expect(dibujar(BloqueDeVigencia, SIN, false)).toBe("");
  });

  it("con una vigencia cargada de antes, solo se la nombra (como texto, sin formulario)", () => {
    const html = dibujar(BloqueDeVigencia, DE_ANTES);
    expect(html).toContain("data-vigencia-anterior");
    expect(html).toContain("los lunes, martes, miércoles, jueves, viernes");
    expect(html).toContain("activar y desactivar");
    expect(html).not.toContain("data-formulario-de-vigencia");
  });
});

describe("vigencia de la promo ENCENDIDA (reversibilidad)", () => {
  afterEach(() => {
    vi.doUnmock("../../src/core/carta/vigencia-de-promo");
    vi.resetModules();
  });

  it("vuelve el título «Vigencia» con el formulario para quien edita, y el texto para quien solo ve", async () => {
    vi.resetModules();
    vi.doMock("../../src/core/carta/vigencia-de-promo", async (original) => ({ ...(await original<typeof import("../../src/core/carta/vigencia-de-promo")>()), VIGENCIA_DE_PROMO_VISIBLE: true }));
    const { BloqueDeVigencia: Bloque } = await import("../../src/app/(app)/carta/parametrizacion/formularios");
    const conPermiso = dibujar(Bloque, SIN);
    expect(conPermiso).toContain(">Vigencia</h3>");
    expect(conPermiso).toContain("data-formulario-de-vigencia");
    const soloVe = dibujar(Bloque, DE_ANTES, false);
    expect(soloVe).toContain(">Vigencia</h3>");
    expect(soloVe).not.toContain("data-formulario-de-vigencia");
    expect(soloVe).toContain("Vale los lunes");
  });
});
