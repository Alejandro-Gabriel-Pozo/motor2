import { test, expect } from "./fixtures/auth";

/**
 * En esta versión de Next un Server Action que no redirige NO re-renderiza la ruta: la pantalla seguía mostrando los datos viejos en un
 * navegador real hasta recargar a mano (node_modules/next/dist/docs/01-app/02-guides/server-actions.md: "An action that does none of the
 * above ... the current route is not re-rendered"). Vitest no lo ve — llama a las acciones directo desde Node —, por eso este spec vive acá.
 *
 * Cada caso hace la mutación y verifica que la pantalla cambió SIN recargar: se deja una marca en `window` antes de empezar, y si hubiera
 * habido una recarga o una navegación completa, la marca desaparecería. (Una navegación de cliente —`router.refresh()`, el refresco del
 * servidor— no la borra.)
 *
 * Los datos van con `Date.now()` (varios specs comparten la misma base dentro de una corrida) y quedan hasta que `globalTeardown` vacía la
 * base E2E al terminar.
 */
type ConMarca = { __sinRecargar?: boolean };
const ponerMarca = (page: import("@playwright/test").Page) => page.evaluate(() => ((window as unknown as ConMarca).__sinRecargar = true));
const marcaSigue = (page: import("@playwright/test").Page) => page.evaluate(() => (window as unknown as ConMarca).__sinRecargar === true);

test("secciones: crear, desactivar y renombrar se ven sin recargar la página", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Sección ${Date.now()}`;
  const renombrada = `${nombre} v2`;
  // La fila se identifica por el valor del input del nombre (`defaultValue`, que React deja como atributo `value`).
  const filaDe = (n: string) => page.locator(`tr:has(input[value="${n}"])`);

  await page.goto("/movimientos/secciones");
  await expect(page.getByRole("heading", { name: /Secciones/ })).toBeVisible();
  await ponerMarca(page);

  // Crear: la sección nueva aparece en la tabla.
  await page.getByPlaceholder("nombre de la sección").fill(nombre);
  await page.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(filaDe(nombre)).toHaveCount(1);
  await expect(filaDe(nombre).getByRole("cell", { name: "Sí", exact: true })).toBeVisible();

  // Desactivar: la columna «Activa» pasa a «No» y el botón a «Activar».
  await filaDe(nombre).getByRole("button", { name: "Desactivar", exact: true }).click();
  await expect(filaDe(nombre).getByRole("cell", { name: "No", exact: true })).toBeVisible();
  await expect(filaDe(nombre).getByRole("button", { name: "Activar", exact: true })).toBeVisible();

  // Renombrar: la fila pasa a mostrar el nombre nuevo (con el servidor ya normalizado).
  await filaDe(nombre).locator('input[name="nombre"]').fill(renombrada);
  await filaDe(nombre).getByRole("button", { name: "Renombrar", exact: true }).click();
  await expect(filaDe(renombrada)).toHaveCount(1);

  expect(await marcaSigue(page), "la página se recargó: el cambio no se vio por el refresco de la acción").toBe(true);
});
