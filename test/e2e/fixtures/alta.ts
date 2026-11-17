import { expect, type Page } from "@playwright/test";

/**
 * Elige la clase del alta («¿Qué es?») y espera a que QUEDE elegida. Si se elige antes de que la pantalla termine de hidratarse, React la vuelve a «Materia prima» y los campos propios de la clase (p. ej. «Precio de
 * venta» de un producto vendible) nunca aparecen: el test se cuelga hasta su timeout (causa del rojo de `espacio-del-producto` y de la medición del lote B). Primero espera a que el `<select>` tenga sus propiedades de
 * React (`__reactProps$…`, las pone la hidratación); después elige y exige que la elección se mantenga un instante, reintentando si se revirtió.
 */
export async function elegirClaseDelAlta(page: Page, etiqueta: string): Promise<void> {
  const selector = page.getByLabel("¿Qué es?");
  await expect.poll(() => selector.evaluate((s) => Object.keys(s).some((k) => k.startsWith("__reactProps$"))), { timeout: 20_000 }).toBe(true);
  await expect(async () => {
    await selector.selectOption({ label: etiqueta });
    await page.waitForTimeout(700);
    expect(await selector.evaluate((s) => (s as HTMLSelectElement).selectedOptions[0]?.textContent ?? "")).toBe(etiqueta);
  }).toPass({ timeout: 30_000 });
}
