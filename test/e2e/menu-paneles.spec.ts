import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { abrirComoRol } from "./fixtures/rol-pos";

/**
 * Los dos paneles del menú lateral (ADR-010): «Empresa» (lo que afecta a toda la empresa) y «Sucursal» (la operación de la sucursal activa).
 * El selector solo existe para quien ve alguna pantalla exclusiva de Empresa; el panel que se muestra es el de la pantalla abierta, y en una
 * pantalla de ambos paneles (Productos) o en el inicio se queda el último elegido.
 */
const selector = (page: Page) => page.getByRole("group", { name: "Panel del menú" });
const boton = (page: Page, nombre: "Empresa" | "Sucursal") => selector(page).getByRole("button", { name: nombre });
const enlace = (page: Page, nombre: string) => page.locator("nav").getByRole("link", { name: nombre, exact: true });

/** El clic en el selector se hace con la página ya hidratada: se reintenta hasta que el botón queda presionado. */
async function elegirPanel(page: Page, nombre: "Empresa" | "Sucursal") {
  await expect(async () => {
    await boton(page, nombre).click();
    await expect(boton(page, nombre)).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass();
}

test("admin: ve el selector de paneles, arranca en Sucursal y cada panel muestra solo lo suyo", async ({ paginaAutenticada: page }) => {
  await page.goto("/inicio");
  await expect(selector(page)).toBeVisible();
  await expect(boton(page, "Sucursal")).toHaveAttribute("aria-pressed", "true");
  await expect(boton(page, "Empresa")).toHaveAttribute("aria-pressed", "false");
  // La sucursal activa se ve siempre bajo el selector, en cualquiera de los dos paneles.
  await expect(page.locator("nav [data-sucursal-activa]")).toHaveText(/^Sucursal: \S/);
  await expect(page.locator("nav").getByRole("button", { name: "Stock" })).toBeVisible();
  await expect(page.locator("nav").getByRole("button", { name: "Traspasos" })).toBeVisible();

  await elegirPanel(page, "Empresa");
  await expect(page.locator("nav").getByRole("button", { name: "Stock" })).toHaveCount(0);
  await expect(page.locator("nav").getByRole("button", { name: "Traspasos" })).toHaveCount(0);
  await expect(page.locator("nav [data-sucursal-activa]")).toBeVisible();
  await expect(page.locator("nav").getByRole("button", { name: "Administración" })).toBeVisible();

  await elegirPanel(page, "Sucursal");
  await expect(page.locator("nav").getByRole("button", { name: "Stock" })).toBeVisible();
});

test("entrar a una pantalla de Empresa activa ese panel y su ítem queda marcado; una de Sucursal vuelve al otro", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/categorias");
  await expect(boton(page, "Empresa")).toHaveAttribute("aria-pressed", "true");
  await expect(boton(page, "Sucursal")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("nav a[aria-current=page]")).toHaveCount(1);
  await expect(enlace(page, "Categorías")).toHaveAttribute("aria-current", "page");
  await expect(page.locator("nav").getByRole("button", { name: "Stock" })).toHaveCount(0);

  await page.goto("/reportes/costos");
  await expect(boton(page, "Sucursal")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("nav a[aria-current=page]")).toHaveCount(1);
  await expect(page.locator("nav").getByRole("button", { name: "Stock" })).toBeVisible();
  await expect(page.locator("nav").getByRole("button", { name: "Traspasos" })).toBeVisible();
});

test("una pantalla de ambos paneles (Productos) conserva el último panel elegido y aparece en los dos", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/categorias");
  await expect(boton(page, "Empresa")).toHaveAttribute("aria-pressed", "true");
  // Navegación del menú (cliente, sin recargar): Productos es de ambos paneles y el panel Empresa sigue activo.
  await page.locator("nav").getByRole("link", { name: "Productos", exact: true }).click();
  await page.waitForURL(/\/catalogo\/productos$/);
  await expect(boton(page, "Empresa")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("nav a[aria-current=page]")).toHaveCount(1);

  // Con Sucursal elegido, la misma pantalla se ve en ese panel.
  await elegirPanel(page, "Sucursal");
  await expect(page.locator("nav a[aria-current=page]")).toHaveCount(1);
  await expect(page.locator("nav a[aria-current=page]")).toHaveText(/Productos/);

  // Y tras recargar en esa pantalla de ambos paneles, vuelve el último elegido (guardado en el navegador).
  await page.reload();
  await expect(boton(page, "Sucursal")).toHaveAttribute("aria-pressed", "true");
  await elegirPanel(page, "Empresa");
  await page.reload();
  await expect(async () => {
    await expect(boton(page, "Empresa")).toHaveAttribute("aria-pressed", "true", { timeout: 1000 });
  }).toPass();
});

test("un rol sin pantallas de Empresa no ve el selector y conserva el menú único de siempre", async ({ browser, baseURL, sucursalId }) => {
  const rol = await abrirComoRol(browser, baseURL, sucursalId, { ver_stock: "ver", proceso_venta: "editar" });
  try {
    await rol.page.goto("/stock/consolidado");
    await expect(rol.page.locator("nav a[aria-current=page]")).toHaveCount(1);
    await expect(selector(rol.page)).toHaveCount(0);
    await expect(rol.page.locator("nav").getByRole("button", { name: "Stock" })).toBeVisible();
    await expect(rol.page.locator("nav").getByRole("button", { name: "Movimientos" })).toBeVisible();
  } finally {
    await rol.limpiar();
  }
});

test("axe: sin violaciones con el panel Empresa y con el panel Sucursal, en modo claro", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/categorias");
  await expect(boton(page, "Empresa")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "panel Empresa, claro").toEqual([]);

  await page.goto("/reportes/costos");
  await expect(boton(page, "Sucursal")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { level: 1, name: "Costos y márgenes" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "panel Sucursal, claro").toEqual([]);
});
