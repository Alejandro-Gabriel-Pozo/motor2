import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { MENU_POR_AREAS, abrirAreasDelMenu } from "./fixtures/menu";

/**
 * El menú por áreas (Frente 6, paso 5; `src/core/navegacion/menu-por-areas.ts`): Ventas · Catálogo · Compras y Cuenta al final, sin selector de paneles; cada área con sus grupos como subencabezados; la pantalla abierta abre su
 * área. Con el interruptor `MENU_POR_AREAS` apagado este caso no aplica (el menú de siempre lo cubren `menu-paneles.spec.ts` y compañía).
 */
test.beforeEach(() => {
  test.skip(!MENU_POR_AREAS, "menú de siempre: no hay áreas");
});

const menu = (page: import("@playwright/test").Page) => page.locator("aside nav");

test("el admin ve las cuatro áreas en su orden, «Cuenta» al final, y ningún selector de paneles", async ({ paginaAutenticada: page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/inicio");
  const areas = await menu(page).locator("button[aria-expanded]").allInnerTexts();
  expect(areas.map((t) => t.replace(/[▾▸]/g, "").trim())).toEqual(["Ventas", "Catálogo", "Compras", "Cuenta"]);
  await expect(page.getByRole("group", { name: "Panel del menú" })).toHaveCount(0);
});

test("cada área muestra sus grupos como subencabezados y sus pantallas como enlaces", async ({ paginaAutenticada: page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/inicio");
  await abrirAreasDelMenu(page);
  for (const grupo of ["Salón", "Clientes", "Reportes", "Productos", "Carta", "Stock", "Traspasos", "Compras", "Proveedores", "Empresa", "Sucursal"]) {
    await expect(menu(page).locator("p", { hasText: new RegExp(`^${grupo}$`, "i") }).first(), grupo).toBeVisible();
  }
  for (const [href, nombre] of [
    ["/catalogo/clientes", "Clientes con descuento"],
    ["/catalogo/productos", "Productos"],
    ["/movimientos/compra", "Compra"],
    ["/catalogo/proveedores", "Proveedores"],
    ["/administracion/permisos", "Permisos"],
  ] as const) {
    await expect(menu(page).locator(`a[href="${href}"]`), nombre).toHaveText(nombre);
  }
});

test("la pantalla abierta abre su área y se marca; las otras áreas vienen plegadas", async ({ paginaAutenticada: page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/catalogo/proveedores");
  const compras = menu(page).getByRole("button", { name: "Compras", exact: false }).first();
  await expect(menu(page).locator("button[aria-expanded='true']")).toHaveCount(1);
  await expect(compras).toHaveAttribute("aria-expanded", "true");
  await expect(menu(page).locator('a[aria-current="page"]')).toHaveCount(1);
  await expect(menu(page).locator('a[aria-current="page"]')).toHaveAttribute("href", "/catalogo/proveedores");
});

test("el menú por áreas no tiene violaciones de accesibilidad", async ({ paginaAutenticada: page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/inicio");
  await abrirAreasDelMenu(page);
  expect((await new AxeBuilder({ page }).include("aside nav").analyze()).violations).toEqual([]);
});
