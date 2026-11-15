import AxeBuilder from "@axe-core/playwright";
import type { Locator } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/** Espera a que React haya hidratado el elemento (mismo criterio que carta-tema-admin.spec.ts): un clic anterior no tendría manejador. */
async function esperarHidratado(el: Locator) {
  await expect
    .poll(() => el.evaluate((nodo) => Object.keys(nodo).some((k) => k.startsWith("__reactProps"))), { message: "elemento hidratado", timeout: 30_000 })
    .toBe(true);
}

/**
 * Color de marca del PORTAL en /carta/portal (`docs/diseno-marca-del-portal-2026-11-13.md`): botón explícito «Pasar a color de marca», rechazo de un color ilegible y «Volver a mis colores anteriores»
 * (quita solo el marcador). En celular (375 px): sin desborde horizontal, objetivo táctil de 44 px y axe 0.
 */
test("portal: pasar a color de marca, rechazo de un color ilegible y volver a los colores anteriores (375 px, axe 0)", async ({ paginaAutenticada: page }) => {
  await prisma.portalCartaEmpresa.deleteMany({});
  await page.setViewportSize({ width: 375, height: 800 });
  try {
    await page.goto("/carta/portal");
    const seccion = page.locator("[data-seccion-marca]");
    await expect(seccion).toHaveAttribute("data-modo", "clasico");
    const pasar = seccion.locator('[data-accion-marca="pasar"]');
    await esperarHidratado(pasar);
    await expect(pasar).toBeDisabled();

    // Un color que casi no se distingue del fondo: el aviso dice qué hacer y el botón sigue deshabilitado.
    await seccion.getByLabel("Color de marca: selector").fill("#ffcb69");
    await expect(seccion.locator("[data-aviso-marca]")).toContainText("Elegí uno más fuerte");
    await expect(pasar).toBeDisabled();

    // Un color que se lee bien: se habilita, se ve la vista previa del portal y no hay desborde horizontal ni violaciones de axe.
    await seccion.getByLabel("Color de marca: selector").fill("#5c57a2");
    await expect(seccion.locator("[data-aviso-marca]")).toContainText("Este color se lee bien.");
    await expect(pasar).toBeEnabled();
    await expect(seccion.locator("[data-vista-previa-marca]")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await pasar.boundingBox())?.height ?? 0, "objetivo táctil de 44 px").toBeGreaterThanOrEqual(44);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // Nada se guardó hasta el clic.
    expect(await prisma.portalCartaEmpresa.count()).toBe(0);
    await pasar.click();
    await expect(page.getByRole("status").filter({ hasText: "guardada" })).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-seccion-marca]")).toHaveAttribute("data-modo", "marca");
    const fila = await prisma.portalCartaEmpresa.findFirstOrThrow();
    expect(fila.valores).toMatchObject({ portal_color_marca: "#5c57a2", portal_marca_derivada: "si" });

    // Volver: quita solo el marcador; el color de marca queda guardado.
    const volver = page.locator('[data-accion-marca="volver"]');
    await esperarHidratado(volver);
    await volver.click();
    await expect(page.getByRole("status").filter({ hasText: "guardada" })).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-seccion-marca]")).toHaveAttribute("data-modo", "clasico");
    const despues = (await prisma.portalCartaEmpresa.findFirstOrThrow()).valores as Record<string, string>;
    expect(despues.portal_marca_derivada ?? "").toBe("");
    expect(despues.portal_color_marca).toBe("#5c57a2");
  } finally {
    await prisma.portalCartaEmpresa.deleteMany({});
  }
});
