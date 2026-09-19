import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Circuito Catálogo — tocar «Editar» en la lista de productos.
 *
 * Bug encontrado por el usuario en producción (2026-09-18): el formulario
 * de edición mostraba el nombre y las observaciones del producto, pero NO su
 * categoría, unidad de stock, precio de venta ni factor de conversión
 * (aparecían vacíos / en 0 / en 1). Causa: la página muestra la lista y el
 * formulario juntos, así que al tocar «Editar» Next hace una navegación
 * suave y React REUTILIZA el `ProductoForm` que ya estaba montado en modo
 * alta; ese formulario guarda categoría, unidad, precio y factor en estado
 * interno (`useState`) que solo se inicializa al montarse, mientras que el
 * nombre y las observaciones son inputs con `defaultValue`, que sí siguen a
 * las props. Ni tsc, ni eslint, ni vitest lo ven: solo un navegador real.
 */
test("al tocar «Editar» con el formulario ya abierto en modo alta, se cargan TODOS los datos del producto", async ({ paginaAutenticada: page }) => {
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

  // 1) La página abre con el formulario montado en modo alta (estado interno vacío)...
  await page.goto(`/catalogo/productos?q=${encodeURIComponent(producto.nombre)}`);
  await expect(page.getByText("Nuevo producto")).toBeVisible();

  // 2) ...y tocar «Editar» es una navegación suave: el formulario NO se vuelve a montar por sí solo.
  await page.getByRole("row", { name: new RegExp(producto.codigo) }).getByRole("link", { name: "Editar" }).click();
  await expect(page.getByText(`Editar "${producto.nombre}"`)).toBeVisible();

  // 3) Todos los campos tienen que reflejar el producto, no solo los que siguen a `defaultValue`.
  await expect(page.locator('input[name="nombre"]')).toHaveValue(producto.nombre);
  await expect(page.locator('textarea[name="observaciones"]')).toHaveValue("Observación E2E");
  await expect(page.locator("select").first().locator("option:checked")).toHaveText(categoria.nombre);
  await expect(page.locator("select[required] option:checked")).toHaveText("unidad");
  await expect(page.locator('input[name="precioVenta"]')).toHaveValue("3200");
  await expect(page.locator('input[name="factorConversion"]')).toHaveValue("24");
});
