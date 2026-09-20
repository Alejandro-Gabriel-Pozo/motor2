import { test, expect } from "./fixtures/auth";

/**
 * Circuito Catálogo — alta de producto con alta rápida de categoría
 * inline ("+ Nueva categoría"). Cubre el fix de QuickCrear (commit
 * 8cf6f23): antes, el modal de alta rápida renderizaba su propio
 * `<form>` DENTRO del `<form>` de Alta/Editar Producto — HTML inválido
 * que hacía perder todo lo ya tipeado en el form exterior al crear la
 * categoría. Ese bug era invisible para tsc/eslint/vitest (ninguno
 * renderiza el DOM real) — solo un navegador real lo reproduce.
 */
test("crear categoría inline no pisa el nombre ya tipeado del producto", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/productos/nuevo");

  const nombreProducto = `E2E Producto ${Date.now()}`;
  await page.locator('input[name="nombre"]').fill(nombreProducto);

  await page.getByRole("button", { name: "+ Nueva categoría" }).click();
  const modal = page.locator(".fixed.inset-0");
  const nombreCategoria = `E2E Categoría ${Date.now()}`;
  await modal.locator("input").first().fill(nombreCategoria);
  await modal.getByRole("button", { name: "Crear" }).click();

  // La prueba real del fix: el nombre tipeado ANTES de abrir el modal
  // tiene que seguir ahí después de crear la categoría — y la categoría
  // recién creada queda seleccionada sola (onCreado corrió, el form
  // exterior no se reseteó).
  await expect(page.locator('input[name="nombre"]')).toHaveValue(nombreProducto);
  await expect(page.locator("select").first().locator("option:checked")).toHaveText(nombreCategoria);
});
