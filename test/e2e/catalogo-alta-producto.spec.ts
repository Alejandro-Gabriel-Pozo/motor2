import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Circuito Catálogo — alta rápida de categoría inline ("+ Nueva categoría") dentro del formulario de producto. Cubre el fix de QuickCrear (commit
 * 8cf6f23): antes, el modal de alta rápida renderizaba su propio `<form>` DENTRO del `<form>` de Alta/Editar Producto — HTML inválido
 * que hacía perder todo lo ya tipeado en el form exterior al crear la categoría. Ese bug era invisible para tsc/eslint/vitest (ninguno
 * renderiza el DOM real) — solo un navegador real lo reproduce.
 *
 * El alta como Pedernal ya no pide categoría (decisión del dueño, 2026-11-17: «¿cuál está el problema en replicar las pantallas de Pedernal?»): el flujo vive en la EDICIÓN del producto, que sigue
 * teniendo el mismo formulario con su «+ Nueva categoría».
 */
test("crear categoría inline no pisa el nombre ya tipeado del producto (en la edición)", async ({ paginaAutenticada: page }) => {
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-CATINL-${Date.now()}`, nombre: `E2E Producto Original ${Date.now()}`, tipo: "MP", unidadStockId: kg.id } });
  const nombreCategoria = `E2E Categoría ${Date.now()}`;
  try {
    await page.goto(`/catalogo/productos/${producto.id}/datos`);

    const nombreProducto = `E2E Producto ${Date.now()}`;
    await page.locator('input[name="nombre"]').fill(nombreProducto);

    await page.getByRole("button", { name: "+ Nueva categoría" }).click();
    // El modal es un `<dialog>` con rol de diálogo (antes se lo buscaba por sus clases CSS, un detalle de implementación).
    const modal = page.getByRole("dialog");
    await modal.locator("input").first().fill(nombreCategoria);
    await modal.getByRole("button", { name: "Crear" }).click();

    // La prueba real del fix: el nombre tipeado ANTES de abrir el modal tiene que seguir ahí después de crear la categoría — y la categoría
    // recién creada queda seleccionada sola (onCreado corrió, el form exterior no se reseteó).
    await expect(page.locator('input[name="nombre"]')).toHaveValue(nombreProducto);
    await expect(page.getByLabel("Categoría").locator("option:checked")).toHaveText(nombreCategoria);
  } finally {
    await prisma.producto.deleteMany({ where: { id: producto.id } });
    await prisma.categoriaProducto.deleteMany({ where: { nombre: nombreCategoria } });
  }
});
