import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Circuito Catálogo — tocar «Editar» en la lista de productos.
 *
 * Bug encontrado por el usuario en producción (2026-09-18): el formulario de edición mostraba el nombre y las observaciones del producto, pero
 * NO su categoría, unidad de stock, precio de venta ni factor de conversión. Causa: la lista y el formulario vivían en la misma página, y al
 * tocar «Editar» React reutilizaba el formulario ya montado en modo alta (estado interno que solo se inicializa al montarse). Desde que la
 * edición tiene su propia ruta (`/catalogo/productos/[id]/editar`) esa clase de bug no puede ocurrir; la prueba se mantiene para asegurar que
 * la pantalla de edición cargue TODOS los datos. Ni tsc, ni eslint, ni vitest lo ven: solo un navegador real.
 */
test("al tocar «Editar» en la lista, la pantalla de edición carga TODOS los datos del producto", async ({ paginaAutenticada: page }) => {
  const sufijo = Date.now();
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: `E2E Categoría ${sufijo}` } });
  const producto = await prisma.producto.create({
    data: {
      codigo: `E2E-${sufijo}`,
      nombre: `E2E Editar ${sufijo}`,
      tipo: "PV",
      categoriaId: categoria.id,
      unidadStockId: unidad.id,
      unidadCompraId: unidad.id,
      factorConversion: 24,
      precioVenta: 3200,
      observaciones: "Observación E2E",
    },
  });

  await page.goto(`/catalogo/productos?q=${encodeURIComponent(producto.nombre)}`);
  await page.getByRole("row", { name: new RegExp(producto.codigo) }).getByRole("link", { name: "Editar", exact: true }).click();
  await page.waitForURL(new RegExp(`/catalogo/productos/${producto.id}/editar$`));
  await expect(page.getByText(`Editar "${producto.nombre}"`)).toBeVisible();

  // Todos los campos tienen que reflejar el producto, no solo los que siguen a `defaultValue`.
  await expect(page.locator('input[name="nombre"]')).toHaveValue(producto.nombre);
  await expect(page.locator('textarea[name="observaciones"]')).toHaveValue("Observación E2E");
  await expect(page.locator("select").first().locator("option:checked")).toHaveText(categoria.nombre);
  await expect(page.locator("select[required] option:checked")).toHaveText("unidad");
  await expect(page.locator('input[name="precioVenta"]')).toHaveValue("3200");
  await expect(page.locator('input[name="factorConversion"]')).toHaveValue("24");
});
