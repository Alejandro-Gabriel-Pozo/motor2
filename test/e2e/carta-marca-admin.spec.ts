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
 * Color de marca en /carta/tema (paso 9, PR C; docs/diseno-marca-por-sucursal-y-empresa-2026-11-12.md): botón explícito «Pasar a color de marca», rechazo de un color que no se lee, y «Volver a mis colores
 * anteriores» (quita solo el marcador). En celular (375 px): sin desborde horizontal y axe 0.
 */
test("pasar a color de marca, rechazo de un color ilegible y volver a los colores anteriores (375 px, axe 0)", async ({ paginaAutenticada: page, sucursalId }) => {
  await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  await page.setViewportSize({ width: 375, height: 800 });
  try {
    await page.goto("/carta/tema");
    const seccion = page.locator("[data-seccion-marca]");
    await expect(seccion).toHaveAttribute("data-modo", "clasico");
    const pasar = seccion.locator('[data-accion-marca="pasar"]');
    await esperarHidratado(pasar);
    await expect(pasar).toBeDisabled();

    // Un color que casi no se distingue del fondo: el aviso dice qué hacer y el botón sigue deshabilitado.
    await seccion.getByLabel("Color de marca: selector").fill("#ffcb69");
    await expect(seccion.locator("[data-aviso-marca]")).toContainText("Elegí uno más fuerte");
    await expect(pasar).toBeDisabled();

    // Un color que se lee bien: se habilita, se ve la vista previa y no hay desborde horizontal ni violaciones de axe.
    await seccion.getByLabel("Color de marca: selector").fill("#5c57a2");
    await expect(seccion.locator("[data-aviso-marca]")).toContainText("Este color se lee bien.");
    await expect(pasar).toBeEnabled();
    await expect(seccion.locator("[data-vista-previa-marca]")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const alto = (await pasar.boundingBox())?.height ?? 0;
    expect(alto, "objetivo táctil de 44 px").toBeGreaterThanOrEqual(44);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // Nada se guardó hasta el clic.
    expect(await prisma.temaCartaSucursal.count({ where: { sucursalId } })).toBe(0);
    await pasar.click();
    await expect(page.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-seccion-marca]")).toHaveAttribute("data-modo", "marca");
    const fila = await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId } });
    expect(fila.valores).toMatchObject({ color_marca: "#5c57a2", marca_derivada: "si" });

    // Volver: quita solo el marcador; el color de marca queda guardado.
    const volver = page.locator('[data-accion-marca="volver"]');
    await esperarHidratado(volver);
    await volver.click();
    await expect(page.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-seccion-marca]")).toHaveAttribute("data-modo", "clasico");
    const despues = (await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId } })).valores as Record<string, string>;
    expect(despues.marca_derivada ?? "").toBe("");
    expect(despues.color_marca).toBe("#5c57a2");
  } finally {
    await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
  }
});
