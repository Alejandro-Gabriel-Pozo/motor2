import AxeBuilder from "@axe-core/playwright";
import type { Locator } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/** Espera a que React haya hidratado el elemento (mismo criterio que carta-marca-portal-admin.spec.ts): un clic anterior no tendría manejador. */
async function esperarHidratado(el: Locator) {
  await expect
    .poll(() => el.evaluate((nodo) => Object.keys(nodo).some((k) => k.startsWith("__reactProps"))), { message: "elemento hidratado", timeout: 30_000 })
    .toBe(true);
}

/**
 * Nombre público de la empresa en /carta/portal (`docs/diseno-nombre-publico-de-la-empresa-en-la-carta-2026-11-14.md`): se carga, se rechaza lo que trae `<` o `>`, se cambia y se quita. En celular (375 px): sin
 * desborde horizontal y axe 0.
 */
test("portal: cargar, rechazar un nombre con < >, cambiar y quitar el nombre público (375 px, axe 0)", async ({ paginaAutenticada: page }) => {
  await prisma.portalCartaEmpresa.deleteMany({});
  await page.setViewportSize({ width: 375, height: 800 });
  try {
    await page.goto("/carta/portal");
    const campo = page.getByLabel("Nombre público de la empresa (títulos y vista previa al compartir)");
    await esperarHidratado(campo);
    await expect(campo).toHaveValue("");
    await expect(page.getByText("Es lo que aparece junto al nombre de la carta en la pestaña del navegador y en Google. Vacío = sin nombre.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // Con < o >: el servidor lo rechaza y no escribe nada.
    await campo.fill("Empresa <B>");
    await page.getByRole("button", { name: "Guardar apariencia" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Nombre público de la empresa" })).toBeVisible();
    expect(await prisma.portalCartaEmpresa.count()).toBe(0);

    // Un nombre válido: se guarda y vuelve cargado al recargar.
    await campo.fill("Empresa B");
    await page.getByRole("button", { name: "Guardar apariencia" }).click();
    await expect(page.getByRole("status").filter({ hasText: "guardada" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Nombre público de la empresa (títulos y vista previa al compartir)")).toHaveValue("Empresa B");
    expect((await prisma.portalCartaEmpresa.findFirstOrThrow()).valores).toMatchObject({ portal_nombre_publico: "Empresa B" });

    // Quitarlo: vuelve a «sin cargar» (la clave se va de lo guardado).
    const otra = page.getByLabel("Nombre público de la empresa (títulos y vista previa al compartir)");
    await esperarHidratado(otra);
    await otra.fill("");
    await page.getByRole("button", { name: "Guardar apariencia" }).click();
    await expect(page.getByRole("status").filter({ hasText: "guardada" })).toBeVisible();
    expect(((await prisma.portalCartaEmpresa.findFirstOrThrow()).valores as Record<string, string>).portal_nombre_publico).toBeUndefined();
  } finally {
    await prisma.portalCartaEmpresa.deleteMany({});
  }
});
