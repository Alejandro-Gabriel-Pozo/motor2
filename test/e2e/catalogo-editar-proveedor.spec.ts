import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Circuito Catálogo — tocar «Editar» en la lista de proveedores.
 *
 * Caso borde de la misma clase que el bug de «Editar producto»
 * (ver test/e2e/catalogo-editar-producto.spec.ts): la lista y el formulario
 * viven en la misma página, así que al pasar de «Editar A» a «Editar B» Next hace
 * una navegación suave y React REUTILIZA el formulario montado. Los campos son
 * inputs con `defaultValue`: si se tipeó algo sin guardar, ese texto sobrevive al
 * cambio de proveedor y se guardaría en B. Ni tsc, ni eslint, ni vitest lo ven.
 */
test("al pasar de «Editar» un proveedor a «Editar» otro, lo tipeado sin guardar no se arrastra", async ({ paginaAutenticada: page }) => {
  const sufijo = Date.now();
  const a = await prisma.proveedor.create({
    data: { codigo: `E2E-A-${sufijo}`, nombre: `E2E Proveedor A ${sufijo}`, contacto: "Contacto A", notas: "Notas A" },
  });
  const b = await prisma.proveedor.create({
    data: { codigo: `E2E-B-${sufijo}`, nombre: `E2E Proveedor B ${sufijo}`, contacto: "Contacto B", notas: "Notas B" },
  });

  await page.goto("/catalogo/proveedores");
  await page.getByRole("row", { name: new RegExp(a.codigo) }).getByRole("link", { name: "Editar" }).click();
  await expect(page.getByText(`Editar "${a.nombre}"`)).toBeVisible();
  await expect(page.locator('input[name="contacto"]')).toHaveValue("Contacto A");

  // Se tipea sobre A y NO se guarda...
  await page.locator('input[name="contacto"]').fill("Tipeado sin guardar");
  await page.locator('textarea[name="notas"]').fill("Notas tipeadas sin guardar");

  // ...y se toca «Editar» en B (navegación suave: el formulario NO se vuelve a montar por sí solo).
  await page.getByRole("row", { name: new RegExp(b.codigo) }).getByRole("link", { name: "Editar" }).click();
  await expect(page.getByText(`Editar "${b.nombre}"`)).toBeVisible();

  // El formulario tiene que mostrar a B, no lo que se tipeó sobre A.
  await expect(page.locator('input[name="contacto"]')).toHaveValue("Contacto B");
  await expect(page.locator('textarea[name="notas"]')).toHaveValue("Notas B");
});

test("al cancelar una edición, el formulario de alta queda vacío y no hereda lo tipeado ni los datos del proveedor", async ({ paginaAutenticada: page }) => {
  const sufijo = Date.now();
  const proveedor = await prisma.proveedor.create({
    data: { codigo: `E2E-C-${sufijo}`, nombre: `E2E Proveedor C ${sufijo}`, contacto: "Contacto C" },
  });

  await page.goto("/catalogo/proveedores");
  await page.getByRole("row", { name: new RegExp(proveedor.codigo) }).getByRole("link", { name: "Editar" }).click();
  await expect(page.getByText(`Editar "${proveedor.nombre}"`)).toBeVisible();
  await page.locator('input[name="contacto"]').fill("Tipeado sin guardar");

  await page.getByRole("link", { name: "Cancelar" }).click();
  await expect(page.getByText("Nuevo proveedor")).toBeVisible();
  await expect(page.locator('input[name="nombre"]')).toHaveValue("");
  await expect(page.locator('input[name="contacto"]')).toHaveValue("");
});
