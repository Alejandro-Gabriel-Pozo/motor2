import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Desde que la edición de un proveedor tiene ruta propia (`/[id]/editar`,
 * F4), la clase de bug que probaba este archivo (la lista y el formulario
 * compartían pantalla, y React reutilizaba el form al pasar de "Editar A" a
 * "Editar B", arrastrando lo tipeado sin guardar) no puede ocurrir más: cada
 * edición monta su propio formulario en su propia navegación. Ver
 * test/e2e/catalogo-editar-producto.spec.ts, mismo criterio para Productos.
 *
 * Lo que queda por probar es que la pantalla de edición carga TODOS los
 * datos del proveedor, y que el nombre se muestra pero no es editable.
 */
test("la edición carga todos los datos del proveedor, y el nombre se muestra sin ser editable", async ({ paginaAutenticada: page }) => {
  const sufijo = Date.now();
  const proveedor = await prisma.proveedor.create({
    data: {
      codigo: `E2E-EDIT-${sufijo}`,
      nombre: `E2E Proveedor Editar ${sufijo}`,
      contacto: "Contacto X",
      telefono: "11-1234-5678",
      email: "proveedor@ejemplo.com",
      cuit: "20123456786",
      condicionesPago: "Contado",
      notas: "Notas del proveedor",
    },
  });

  await page.goto(`/catalogo/proveedores/${proveedor.id}/editar`);

  await expect(page.locator('input[name="nombre"]')).toHaveCount(0);
  await expect(page.getByText(proveedor.nombre, { exact: true })).toBeVisible();
  await expect(page.locator('input[name="contacto"]')).toHaveValue("Contacto X");
  await expect(page.locator('input[name="telefono"]')).toHaveValue("11-1234-5678");
  await expect(page.locator('input[name="email"]')).toHaveValue("proveedor@ejemplo.com");
  await expect(page.locator('input[name="cuit"]')).toHaveValue("20-12345678-6");
  await expect(page.locator('input[name="condicionesPago"]')).toHaveValue("Contado");
  await expect(page.locator('textarea[name="notas"]')).toHaveValue("Notas del proveedor");
});
