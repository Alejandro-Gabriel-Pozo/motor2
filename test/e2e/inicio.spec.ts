import { test, expect } from "./fixtures/auth";
import { abrirComoRol } from "./fixtures/rol-pos";

/**
 * La pantalla de inicio (`/inicio`), como la de Pedernal: título «Inicio», «Estás en {empresa}.» y la ranura «Lo que falta». Es a donde se entra por `/` (salvo quien solo tiene el salón, que va directo
 * al mapa de mesas) y a donde apunta «Motor2» en el menú. Los accesos a cada módulo van en el menú, no acá; qué módulos ve cada rol lo cubre `test/permisos/menu-por-permiso.test.ts` (`tarjetasDelUsuario`).
 */
test("admin: `/` lleva a /inicio con el título, dónde está y «Lo que falta» vacía", async ({ paginaAutenticada: page }) => {
  await page.goto("/");
  await page.waitForURL(/\/inicio$/);
  await expect(page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
  await expect(page.getByText(/^Estás en .+\.$/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Lo que falta" })).toBeVisible();
  await expect(page.getByText("No hay nada pendiente por ahora.")).toBeVisible();
  await expect(page.locator("main ul li a")).toHaveCount(0);
});

test("«Motor2» del menú vuelve a /inicio desde cualquier pantalla", async ({ paginaAutenticada: page }) => {
  await page.goto("/reportes/costos");
  await page.getByRole("link", { name: "Motor2" }).click();
  await page.waitForURL(/\/inicio$/);
});

test("un rol con un solo módulo que no es el salón pasa por /inicio", async ({ browser, baseURL, sucursalId }) => {
  const rol = await abrirComoRol(browser, baseURL, sucursalId, { ver_stock: "ver" });
  try {
    await rol.page.goto("/");
    await rol.page.waitForURL(/\/inicio$/);
    await expect(rol.page.getByRole("heading", { level: 1, name: "Inicio" })).toBeVisible();
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

test("un rol sin ningún permiso ve el mensaje que lo explica", async ({ browser, baseURL, sucursalId }) => {
  const vacio = await abrirComoRol(browser, baseURL, sucursalId, {});
  try {
    await vacio.page.goto("/");
    await vacio.page.waitForURL(/\/inicio$/);
    await expect(vacio.page.getByRole("heading", { name: "Todavía no tenés pantallas habilitadas" })).toBeVisible();
  } finally {
    await vacio.limpiar();
  }
});
