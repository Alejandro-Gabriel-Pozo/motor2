import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { usuarioConDosSucursales } from "./fixtures/dos-sucursales";

/**
 * «Administración», en el encabezado del salón, vuelve a la última pantalla de gestión que se abrió en ESTA pestaña (con su consulta);
 * sin nada que recordar (pestaña nueva) lleva a la pantalla de inicio. Si la sucursal cambió desde entonces, se aplica la regla del
 * cambio de sucursal (la misma pantalla sin la consulta).
 */

const CLAVE = "motor2.pantalla-de-gestion";

/** Espera a que React haya hidratado el enlace: antes de eso muestra el valor del servidor (inicio) y un «va a inicio» pasaría aunque lo recordado se ignorara mal. */
async function esperarHidratacion(page: Page) {
  await page.waitForFunction(() => {
    const enlace = [...document.querySelectorAll("a")].find((a) => a.textContent?.startsWith("Administración"));
    return !!enlace && Object.keys(enlace).some((k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps"));
  });
}

async function esperarQueSeRecuerde(page: Page, ruta: string) {
  await expect.poll(async () => page.evaluate((c) => sessionStorage.getItem(c), CLAVE)).toContain(ruta);
}

test("desde un reporte con filtros, al salón y «Administración» vuelve al mismo reporte con sus filtros; se mantiene tras recargar el salón", async ({ paginaAutenticada: page }) => {
  await page.goto("/reportes/costos?desde=2026-09-01");
  await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();
  await esperarQueSeRecuerde(page, "/reportes/costos");

  await page.goto("/mesas");
  await expect(page.getByRole("link", { name: "Administración" })).toBeVisible();
  await page.reload();
  await esperarHidratacion(page);
  await page.getByRole("link", { name: "Administración" }).click();
  await page.waitForURL((url) => url.pathname === "/reportes/costos" && url.search === "?desde=2026-09-01");
  await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();
});

test("recorrer el salón (mapa y pantalla de una mesa) no pisa la pantalla de gestión recordada", async ({ paginaAutenticada: page, sucursalId }) => {
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 971 } });
  try {
    await page.goto("/reportes/costos?desde=2026-09-01");
    await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();
    await esperarQueSeRecuerde(page, "/reportes/costos");

    await page.goto("/mesas");
    await page.goto(`/mesas/${mesa.id}`);
    await esperarHidratacion(page);
    await page.getByRole("link", { name: "Administración" }).click();
    await page.waitForURL((url) => url.pathname === "/reportes/costos" && url.search === "?desde=2026-09-01");
  } finally {
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
  }
});

test("en una pestaña nueva (sin nada recordado), «Administración» lleva a la pantalla de inicio", async ({ browser, baseURL, sucursalId }) => {
  const { page, limpiar } = await usuarioConDosSucursales(browser, baseURL, sucursalId, "admin", "admin");
  try {
    await page.goto("/mesas");
    await page.getByRole("link", { name: "Administración" }).click();
    await page.waitForURL(/\/inicio$/);
  } finally {
    await limpiar();
  }
});

test("lo recordado que no sirve (alterado, de otro sitio o del salón) se ignora: «Administración» lleva a la pantalla de inicio", async ({ browser, baseURL, sucursalId }) => {
  const { page, segunda, limpiar } = await usuarioConDosSucursales(browser, baseURL, sucursalId, "admin", "admin");
  try {
    await page.goto("/mesas");
    // Control positivo: lo válido SÍ cambia el destino, así que la espera de hidratación de abajo es real.
    await page.evaluate(([c, v]) => sessionStorage.setItem(c, v), [CLAVE, JSON.stringify({ sucursalId, ruta: "/reportes/costos?desde=2026-09-01" })]);
    await page.reload();
    await esperarHidratacion(page);
    await expect(page.getByRole("link", { name: "Administración" })).toHaveAttribute("href", "/reportes/costos?desde=2026-09-01");
    for (const valor of ['{"sucursalId":"' + sucursalId + '","ruta":"//sitio-falso.example.com"}', '{"sucursalId":"' + sucursalId + '","ruta":"/mesas"}', "no es json", '{"sucursalId":"' + segunda.id + '","ruta":"https://sitio-falso.example.com"}']) {
      await page.evaluate(([c, v]) => sessionStorage.setItem(c, v), [CLAVE, valor]);
      await page.reload();
      await esperarHidratacion(page);
      await expect(page.getByRole("link", { name: "Administración" })).toHaveAttribute("href", "/inicio");
    }
  } finally {
    await limpiar();
  }
});

test("si la sucursal se cambió en el salón, «Administración» vuelve a la misma pantalla de la sucursal nueva, sin la consulta", async ({ browser, baseURL, sucursalId }) => {
  const { page, segunda, limpiar } = await usuarioConDosSucursales(browser, baseURL, sucursalId, "admin", "admin");
  try {
    await page.goto("/reportes/costos?desde=2026-09-01");
    await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();
    await esperarQueSeRecuerde(page, "/reportes/costos");

    await page.goto("/mesas");
    await page.getByLabel("Sucursal activa").selectOption(segunda.id);
    await expect(page.getByLabel("Sucursal activa")).toHaveValue(segunda.id);
    await expect(page.getByRole("link", { name: "Administración" })).toHaveAttribute("href", "/reportes/costos");
    await page.getByRole("link", { name: "Administración" }).click();
    await page.waitForURL((url) => url.pathname === "/reportes/costos" && url.search === "");
  } finally {
    await limpiar();
  }
});
