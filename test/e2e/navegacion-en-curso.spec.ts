import { test, expect } from "./fixtures/auth";
import AxeBuilder from "@axe-core/playwright";

/**
 * Pendiente #44 (feedback al hacer click): el enlace del menú muestra que la navegación está en curso (`IndicadorDeEnlace` → `data-pendiente`). Se retiene
 * a mano la respuesta RSC de la pantalla de destino (petición con cabecera `rsc` y SIN `next-router-prefetch`) para poder mirar el estado «en curso».
 * El destino (/catalogo/unidades) no tiene `loading.tsx`: con uno, Next da por terminada la transición al dibujar el esqueleto.
 */
test("menú: el enlace marca la navegación en curso y lo saca al llegar", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/categorias");
  const enlace = page.locator('nav a[href="/catalogo/unidades"]');
  const indicador = enlace.locator(".indicador-enlace");
  await expect(indicador).toHaveAttribute("data-pendiente", "false");

  let liberar!: () => void;
  const retenido = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  await page.route("**/catalogo/unidades**", async (route) => {
    const h = route.request().headers();
    if (h["rsc"] && !h["next-router-prefetch"]) await retenido;
    await route.continue();
  });

  await enlace.click();
  await expect(indicador).toHaveAttribute("data-pendiente", "true");

  const resultados = await new AxeBuilder({ page }).include("nav").analyze();
  expect(resultados.violations).toEqual([]);

  liberar();
  await page.waitForURL("**/catalogo/unidades");
  await expect(indicador).toHaveAttribute("data-pendiente", "false");
});
