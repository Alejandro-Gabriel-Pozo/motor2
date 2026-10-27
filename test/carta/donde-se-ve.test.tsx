import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
// Las Server Actions arrastran la sesión (next-auth) que no se carga fuera de Next: el render del servidor no las ejecuta, alcanza con que existan.
vi.mock("../../src/server/actions/refrescar", () => ({ refrescarVistaSiHaceFalta: vi.fn() }));
import { DondeSeVe } from "../../src/app/(app)/carta/parametrizacion/promociones/donde-se-ve";

/**
 * «Dónde se ve» una promo (interruptor «solo salón», docs/diseno-promo-solo-salon-2026-10-26.md, paso 5): la casilla con su etiqueta atada y su ayuda, el `name` que lee la acción, el botón, el estado guardado, el resumen de solo lectura para quien no
 * puede definir promos y el aviso (sin bloquear) de una promo en «solo salón» sin cupos. Se mira el HTML del servidor.
 */
const guardar = vi.fn();
const dibujar = (extra: Partial<Parameters<typeof DondeSeVe>[0]> = {}) =>
  renderToStaticMarkup(<DondeSeVe titulo="Menú pactado" soloSalon={false} tieneCupos puedeDefinir guardar={guardar} {...extra} />);

describe("DondeSeVe: quien puede definir promos", () => {
  const html = dibujar();

  it("la casilla lleva su etiqueta atada (htmlFor/id), su ayuda descrita y el name que lee la acción", () => {
    const etiqueta = "Solo salón: se vende desde el POS, pero no aparece en la carta pública \\(web, QR ni impresa\\)";
    const m = new RegExp(`<label for="([^"]+)"[^>]*>${etiqueta}</label>`).exec(html);
    expect(m, "etiqueta de la casilla").not.toBeNull();
    expect(html).toMatch(new RegExp(`id="${m![1]}"`));
    expect(html).toContain('name="soloSalon"');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Útil para un menú pactado con una empresa: el precio no queda publicado.");
    expect(html).toMatch(/aria-describedby="[^"]+-ayuda"/);
  });

  it("tiene el botón «Guardar dónde se ve», el título del bloque y el marcador para los e2e", () => {
    expect(html).toContain("Guardar dónde se ve");
    expect(html).toContain("Dónde se ve");
    expect(html).toContain('data-donde-se-ve="Menú pactado"');
  });

  it("la casilla llega destildada con la promo en los dos lugares y tildada con «solo salón»", () => {
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    expect(dibujar({ soloSalon: true })).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
  });

  it("sin el aviso cuando la promo tiene cupos o no está en «solo salón»", () => {
    expect(html).not.toContain("data-aviso-solo-salon-sin-cupos");
    expect(dibujar({ soloSalon: true, tieneCupos: true })).not.toContain("data-aviso-solo-salon-sin-cupos");
    expect(dibujar({ soloSalon: false, tieneCupos: false })).not.toContain("data-aviso-solo-salon-sin-cupos");
  });

  it("una promo en «solo salón» sin cupos avisa que el POS la ignora (aviso de texto, sin bloquear: la casilla y el botón siguen)", () => {
    const sinCupos = dibujar({ soloSalon: true, tieneCupos: false });
    expect(sinCupos).toContain('data-aviso-solo-salon-sin-cupos="Menú pactado"');
    expect(sinCupos).toContain("el POS la ignora");
    expect(sinCupos).toContain("Guardar dónde se ve");
  });
});

describe("DondeSeVe: quien solo ve", () => {
  it("muestra el dato de solo lectura, sin casilla ni botón", () => {
    const html = dibujar({ puedeDefinir: false });
    expect(html).toContain("Salón y carta pública");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain("Guardar dónde se ve");
    expect(dibujar({ puedeDefinir: false, soloSalon: true })).toContain("Solo salón (no aparece en la carta pública)");
  });
});
