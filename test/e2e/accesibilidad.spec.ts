import { test as base, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test as testAutenticado } from "./fixtures/auth";

/**
 * Primera pasada de accesibilidad (WCAG 2.1 A/AA vía axe-core), sobre dos
 * pantallas representativas: la pública (login, sin sesión) y una
 * autenticada con datos reales (Costos y márgenes). No es exhaustivo sobre
 * las 19 pantallas — es el punto de partida para sumar más específicas si
 * aparece una necesidad concreta, no una auditoría completa.
 */

base("login: sin violaciones de accesibilidad detectables por axe", async ({ page }) => {
  await page.goto("/login");
  const resultados = await new AxeBuilder({ page }).analyze();
  expect(resultados.violations).toEqual([]);
});

testAutenticado("reportes/costos: sin violaciones de accesibilidad detectables por axe", async ({ paginaAutenticada: page }) => {
  await page.goto("/reportes/costos");
  await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();
  const resultados = await new AxeBuilder({ page }).analyze();
  expect(resultados.violations).toEqual([]);
});
