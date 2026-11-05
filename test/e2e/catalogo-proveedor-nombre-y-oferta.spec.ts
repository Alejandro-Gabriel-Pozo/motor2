import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Proveedores (2026-11-04): el dueño cargó el proveedor de la luz con un nombre abreviado y no podía corregirlo. En CELULAR (375 px, el ancho al que lo usa): abrir su edición, CORREGIR el nombre,
 * marcarlo «servicios» (y desmarcar «productos»), guardar y ver la ficha y la lista con la etiqueta; un nombre que ya usa otro proveedor se rechaza nombrando al otro; sin ninguna casilla marcada
 * se rechaza con un mensaje claro. Sin desborde horizontal y accesibilidad (axe) en 0 en la ficha, el formulario y la lista. Datos propios con una marca única (la base del CI es compartida).
 */
test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

const sinDesborde = async (page: import("@playwright/test").Page, donde: string) => {
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(desborde, `${donde}: sin desborde horizontal`).toBeLessThanOrEqual(0);
  expect((await new AxeBuilder({ page }).analyze()).violations, `${donde}: axe`).toEqual([]);
};

test("corregir el nombre del proveedor de la luz y marcarlo «servicios» (375 px)", async ({ paginaAutenticada: page }) => {
  const marca = Date.now();
  const luz = await prisma.proveedor.create({ data: { codigo: `E2E-LUZ-${marca}`, nombre: `Edenor SA ${marca}` } });
  const otro = await prisma.proveedor.create({ data: { codigo: `E2E-OTRO-${marca}`, nombre: `Gas del Sur ${marca}` } });

  await page.goto(`/catalogo/proveedores/${luz.id}`);
  await expect(page.getByTestId("oferta-del-proveedor")).toHaveText("Productos");
  await sinDesborde(page, "Ficha");

  await page.goto(`/catalogo/proveedores/${luz.id}/editar`);
  const nombre = page.getByLabel("Nombre");
  await expect(nombre).toBeEditable();
  await expect(nombre).toHaveValue(`Edenor SA ${marca}`);
  await sinDesborde(page, "Formulario de edición");

  // Un nombre que ya usa otro proveedor se rechaza nombrando al otro (sin distinguir mayúsculas).
  await nombre.fill(`GAS DEL SUR ${marca}`);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText(`Ya existe un proveedor llamado «Gas del Sur ${marca}»`)).toBeVisible();
  expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: luz.id } })).nombre).toBe(`Edenor SA ${marca}`);

  // Sin ninguna de las dos casillas, se rechaza con un mensaje claro.
  await nombre.fill(`Edenor SA ${marca}`);
  await page.getByLabel("Productos", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Marcá al menos una opción")).toBeVisible();

  // El cambio bueno: nombre corregido y «servicios».
  await nombre.fill(`Edenor S.A. (luz) ${marca}`);
  await page.getByLabel("Servicios (luz, gas, alquiler…)").check();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await page.waitForURL(`**/catalogo/proveedores/${luz.id}?guardado=cambios`);
  await expect(page.getByRole("heading", { name: `Edenor S.A. (luz) ${marca}` })).toBeVisible();
  await expect(page.getByTestId("oferta-del-proveedor")).toHaveText("Servicios");
  await sinDesborde(page, "Ficha después de guardar");

  const guardado = await prisma.proveedor.findUniqueOrThrow({ where: { id: luz.id } });
  expect([guardado.id, guardado.codigo, guardado.nombre, guardado.ofreceProductos, guardado.ofreceServicios]).toEqual([luz.id, `E2E-LUZ-${marca}`, `Edenor S.A. (luz) ${marca}`, false, true]);
  const filas = await prisma.registroAuditoria.findMany({ where: { entidad: "Proveedor", entidadId: luz.id }, select: { campo: true } });
  expect(filas.map((f) => f.campo).sort()).toEqual(["nombre", "ofreceProductos", "ofreceServicios"]);

  // La lista muestra la etiqueta de cada uno.
  await page.goto("/catalogo/proveedores");
  const fila = page.getByRole("row", { name: new RegExp(`Edenor S\\.A\\. \\(luz\\) ${marca}`) });
  await expect(fila).toContainText("Servicios");
  await expect(page.getByRole("row", { name: new RegExp(`Gas del Sur ${marca}`) })).toContainText("Productos");
  await sinDesborde(page, "Lista de proveedores");
  void otro;
});
