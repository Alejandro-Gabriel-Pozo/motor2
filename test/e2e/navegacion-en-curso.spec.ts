import { test, expect } from "./fixtures/auth";
import AxeBuilder from "@axe-core/playwright";

/**
 * Pendiente #44 (feedback al hacer click): el enlace del menú muestra que la navegación está en curso (`IndicadorDeEnlace` → `data-pendiente`). Se retiene
 * a mano la respuesta RSC de la pantalla de destino (petición con cabecera `rsc` y SIN `next-router-prefetch`) para poder mirar el estado «en curso».
 * El enlace es del menú lateral (Unidades ahora es una pestaña de Maestros, que no lleva indicador) y el destino (/catalogo/clientes) no tiene `loading.tsx`: con uno, Next da por terminada la transición al dibujar el esqueleto.
 */
test("menú: el enlace marca la navegación en curso y lo saca al llegar", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/categorias");
  const enlace = page.locator('aside nav a[href="/catalogo/clientes"]');
  const indicador = enlace.locator(".indicador-enlace");
  await expect(indicador).toHaveAttribute("data-pendiente", "false");

  let liberar!: () => void;
  const retenido = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  await page.route("**/catalogo/clientes**", async (route) => {
    const h = route.request().headers();
    if (h["rsc"] && !h["next-router-prefetch"]) await retenido;
    await route.continue();
  });

  await enlace.click();
  await expect(indicador).toHaveAttribute("data-pendiente", "true");

  const resultados = await new AxeBuilder({ page }).include("aside nav").analyze();
  expect(resultados.violations).toEqual([]);

  liberar();
  await page.waitForURL("**/catalogo/clientes");
  await expect(indicador).toHaveAttribute("data-pendiente", "false");
});
