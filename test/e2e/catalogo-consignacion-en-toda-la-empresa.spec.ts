import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { usuarioConDosSucursales } from "./fixtures/dos-sucursales";

/**
 * P20 (D23 del dueño, 2026-10-11): el costo de consignación de un producto lo cambia quien tiene `pagar_consignante` en ALGUNA de sus sucursales de la empresa, y el resultado no depende de
 * la sucursal activa. Acá se mira en el navegador: una persona que es administradora en «Central» y operadora en la segunda sucursal abre la edición estando parada en la segunda (donde es
 * operadora) y ve el bloque de consignación; guarda un costo nuevo y se persiste; al pasar a «Central» ve lo mismo. Que un operador en las dos sucursales NO lo ve lo cubre
 * `catalogo-productos-permiso-editar.spec.ts` (un solo rol sin la clave) y `test/catalogo/costo-consignacion-solo-administrador.test.ts` (D23).
 * Usuario propio por caso (el rol `operador` compartido lo mutan otros specs): `usuarioConDosSucursales` crea la sesión y la sucursal, y las borra al terminar.
 */
async function sembrarProductoEnConsignacion() {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const proveedor = await prisma.proveedor.create({ data: { codigo: `E2E-CONS-${marca}`, nombre: `E2E Consignante ${marca}` } });
  const producto = await prisma.producto.create({
    data: { codigo: `E2E-CONS-${marca}`, nombre: `E2E Consignación ${marca}`, tipo: "MP", unidadStockId: kg.id, esConsignacion: true, proveedorConsignacionId: proveedor.id, precioConsignacion: 1234 },
  });
  return {
    producto,
    proveedor,
    limpiar: async () => {
      await prisma.producto.deleteMany({ where: { id: producto.id } });
      await prisma.proveedor.deleteMany({ where: { id: proveedor.id } });
    },
  };
}

/** CampoNumero muestra el número formateado y pasa al crudo al tomar el foco: primero el foco, después se reemplaza el valor. */
async function escribirNumero(page: Page, etiqueta: string, valor: string) {
  const campo = page.getByLabel(etiqueta, { exact: true });
  await campo.focus();
  await campo.fill(valor);
  await campo.blur();
}

test("admin en Central y operador en la segunda: parado en la segunda ve el bloque de consignación y guarda el costo; en Central ve lo mismo", async ({ browser, baseURL, sucursalId }) => {
  const { page, segunda, limpiar } = await usuarioConDosSucursales(browser, baseURL, sucursalId, "admin", "operador");
  const { producto, proveedor, limpiar: limpiarProducto } = await sembrarProductoEnConsignacion();
  try {
    await page.goto("/inicio");
    await page.getByLabel("Sucursal activa").selectOption(segunda.id);
    await expect(page.getByLabel("Sucursal activa")).toHaveValue(segunda.id);

    await page.goto(`/catalogo/productos/${producto.id}/editar`);
    await expect(page.locator('input[name="nombre"]')).toHaveValue(producto.nombre);
    await expect(page.getByLabel("Es consignación")).toBeChecked();
    await expect(page.getByLabel("Proveedor de consignación")).toBeVisible();
    await expect(page.getByLabel("Precio de consignación", { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations, "edición con el bloque de consignación, parado en la segunda sucursal").toEqual([]);

    await escribirNumero(page, "Precio de consignación", "2000");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.waitForURL(new RegExp(`/catalogo/productos/${producto.id}\\?guardado=cambios$`));
    const guardado = await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } });
    expect(Number(guardado.precioConsignacion)).toBe(2000);
    expect(guardado.proveedorConsignacionId).toBe(proveedor.id);
    // La ficha (Ver incluye Editar) también muestra el costo estando parada en la segunda.
    await expect(page.getByText(proveedor.nombre).first()).toBeVisible();

    // Al pasar a Central: lo mismo.
    await page.getByLabel("Sucursal activa").selectOption(sucursalId);
    await expect(page.getByLabel("Sucursal activa")).toHaveValue(sucursalId);
    await page.goto(`/catalogo/productos/${producto.id}/editar`);
    await expect(page.getByLabel("Es consignación")).toBeChecked();
    await expect(page.getByLabel("Precio de consignación", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Proveedor de consignación")).toBeVisible();
  } finally {
    await limpiarProducto();
    await limpiar();
  }
});
