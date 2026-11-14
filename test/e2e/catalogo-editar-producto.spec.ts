import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Circuito Catálogo — tocar «Editar» en la lista de productos.
 *
 * Bug encontrado por el usuario en producción (2026-09-18): el formulario de edición mostraba el nombre y las observaciones del producto, pero
 * NO su categoría, unidad de stock, precio de venta ni factor de conversión. Causa: la lista y el formulario vivían en la misma página, y al
 * tocar «Editar» React reutilizaba el formulario ya montado en modo alta (estado interno que solo se inicializa al montarse). Desde que la
 * edición tiene su propia ruta (`/catalogo/productos/[id]/datos`, el paso 1 del espacio del producto) esa clase de bug no puede ocurrir; la prueba se mantiene para asegurar que
 * la pantalla de edición cargue TODOS los datos. Ni tsc, ni eslint, ni vitest lo ven: solo un navegador real.
 */
test("al abrir un producto de la lista y tocar «Editar», la pantalla de edición carga TODOS los datos del producto", async ({ paginaAutenticada: page }) => {
  const sufijo = Date.now();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
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
  await page.locator("li[data-producto]", { hasText: producto.nombre }).getByRole("link", { name: producto.nombre }).click();
  await page.waitForURL(new RegExp(`/catalogo/productos/${producto.id}$`));
  // La pestaña Datos ES el formulario de los datos (como en Pedernal): no hay un paso aparte para editar.
  await expect(page.getByRole("heading", { level: 1, name: producto.nombre })).toBeVisible();

  // Todos los campos tienen que reflejar el producto, no solo los que siguen a `defaultValue`.
  await expect(page.locator('input[name="nombre"]')).toHaveValue(producto.nombre);
  // «Observaciones» está oculto con el interruptor (dueño, 2026-11-13): el campo no se dibuja, el dato sigue en la base.
  await expect(page.locator('textarea[name="observaciones"]')).toHaveCount(0);
  await expect(page.locator("select").first().locator("option:checked")).toHaveText(categoria.nombre);
  await expect(page.locator("select[required] option:checked")).toHaveText("unidad");
  await expect(page.locator('input[name="precioVenta"]')).toHaveValue("3200");
  await expect(page.locator('input[name="factorConversion"]')).toHaveValue("24");
});
