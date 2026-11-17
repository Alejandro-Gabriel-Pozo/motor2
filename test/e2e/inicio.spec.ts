import { test, expect } from "./fixtures/auth";
import { abrirComoRol } from "./fixtures/rol-pos";

/**
 * La pantalla de inicio (`/inicio`): una tarjeta por módulo que el rol puede abrir. Es a donde se entra por `/` (salvo quien solo
 * tiene el salón, que va directo al mapa de mesas) y a donde apunta «Motor2» en el menú.
 */
const TARJETAS = "main ul li a";

test("admin: `/` lleva a /inicio con las 8 tarjetas (el salón incluido) y un clic en una tarjeta abre la primera pantalla de ese módulo", async ({ paginaAutenticada: page }) => {
  await page.goto("/");
  await page.waitForURL(/\/inicio$/);
  await expect(page.getByRole("heading", { level: 1, name: /^Hola — estás en / })).toBeVisible();
  await expect(page.locator(TARJETAS)).toHaveCount(8);
  await expect(page.locator(TARJETAS).filter({ hasText: "Salón" })).toHaveAttribute("href", "/mesas");

  await page.locator(TARJETAS).filter({ hasText: "Stock" }).click();
  await page.waitForURL(/\/stock\/consolidado$/);
});

test("«Motor2» del menú vuelve a /inicio desde cualquier pantalla", async ({ paginaAutenticada: page }) => {
  await page.goto("/reportes/costos");
  await page.getByRole("link", { name: "Motor2" }).click();
  await page.waitForURL(/\/inicio$/);
});

test("un rol con varios módulos ve solo las tarjetas de esos módulos (sin Administración ni Salón)", async ({ browser, baseURL, sucursalId }) => {
  const rol = await abrirComoRol(browser, baseURL, sucursalId, { ver_stock: "ver", proceso_merma: "editar" });
  try {
    await rol.page.goto("/");
    await rol.page.waitForURL(/\/inicio$/);
    await expect(rol.page.locator(TARJETAS)).toHaveCount(2);
    await expect(rol.page.locator(TARJETAS).filter({ hasText: "Movimientos" })).toHaveAttribute("href", "/movimientos/merma");
    await expect(rol.page.locator(TARJETAS).filter({ hasText: "Stock" })).toHaveAttribute("href", "/stock/consolidado");
    await expect(rol.page.locator(TARJETAS).filter({ hasText: "Administración" })).toHaveCount(0);
    await expect(rol.page.locator(TARJETAS).filter({ hasText: "Salón" })).toHaveCount(0);
  } finally {
    await rol.limpiar();
  }
});

test("CAMBIO DECLARADO (Frente 6, paso 4): un rol cuya única acción de Movimientos es la carga de ventas sin ticket ya no ve ese grupo ni su tarjeta (la pantalla está oculta), pero la dirección sigue abriendo", async ({ browser, baseURL, sucursalId }) => {
  const rol = await abrirComoRol(browser, baseURL, sucursalId, { ver_stock: "ver", proceso_venta: "editar" });
  try {
    await rol.page.goto("/");
    await rol.page.waitForURL(/\/inicio$/);
    await expect(rol.page.locator(TARJETAS).filter({ hasText: "Movimientos" })).toHaveCount(0);
    await expect(rol.page.locator(TARJETAS).filter({ hasText: "Stock" })).toHaveCount(1);
    await rol.page.goto("/movimientos/venta");
    await expect(rol.page.getByRole("heading", { level: 1, name: "Carga de ventas sin ticket" })).toBeVisible();
  } finally {
    await rol.limpiar();
  }
});

test("un rol con un solo módulo que no es el salón pasa por /inicio, con una sola tarjeta", async ({ browser, baseURL, sucursalId }) => {
  const rol = await abrirComoRol(browser, baseURL, sucursalId, { ver_stock: "ver" });
  try {
    await rol.page.goto("/");
    await rol.page.waitForURL(/\/inicio$/);
    await expect(rol.page.locator(TARJETAS)).toHaveCount(1);
  } finally {
    await rol.limpiar();
  }
});

test("quien solo tiene el salón (el mozo) entra directo a /mesas", async ({ browser, baseURL, sucursalId }) => {
  const mozo = await abrirComoRol(browser, baseURL, sucursalId, { pos_mesas: "ver" });
  try {
    await mozo.page.goto("/");
    await mozo.page.waitForURL(/\/mesas$/);
    await expect(mozo.page.getByRole("heading", { level: 1, name: "Mapa de mesas" })).toBeVisible();
  } finally {
    await mozo.limpiar();
  }
});

test("un rol sin ningún permiso ve el mensaje que lo explica, sin tarjetas", async ({ browser, baseURL, sucursalId }) => {
  const vacio = await abrirComoRol(browser, baseURL, sucursalId, {});
  try {
    await vacio.page.goto("/");
    await vacio.page.waitForURL(/\/inicio$/);
    await expect(vacio.page.getByRole("heading", { name: "Todavía no tenés pantallas habilitadas" })).toBeVisible();
    await expect(vacio.page.locator(TARJETAS)).toHaveCount(0);
  } finally {
    await vacio.limpiar();
  }
});
