import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { usuarioConDosSucursales } from "./fixtures/dos-sucursales";

/**
 * Al cambiar de sucursal con el selector se vuelve a LA MISMA pantalla (sin la consulta ni los ids de la ruta) si el rol la ve en la
 * sucursal nueva; si no, a la pantalla de inicio. Y el cambio reemplaza la entrada del historial: «Atrás» no vuelve a la sucursal anterior.
 */

test("desde un reporte con filtros, el cambio de sucursal queda en el mismo reporte sin la consulta, y «Atrás» no vuelve a la sucursal anterior", async ({ browser, baseURL, sucursalId }) => {
  const { page, segunda, limpiar } = await usuarioConDosSucursales(browser, baseURL, sucursalId, "admin", "admin");
  try {
    await page.goto("/inicio");
    await page.goto("/reportes/costos?desde=2026-09-01");
    await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();

    await page.getByLabel("Sucursal activa").selectOption(segunda.id);
    await page.waitForURL((url) => url.pathname === "/reportes/costos" && url.search === "");
    await expect(page.getByLabel("Sucursal activa")).toHaveValue(segunda.id);
    await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();

    await page.goBack();
    await page.waitForURL(/\/inicio$/);
  } finally {
    await limpiar();
  }
});

test("desde la pantalla de una mesa, el cambio de sucursal cae en el mapa de mesas (el id de la mesa era de la otra sucursal)", async ({ browser, baseURL, sucursalId }) => {
  const { page, segunda, limpiar } = await usuarioConDosSucursales(browser, baseURL, sucursalId, "admin", "admin");
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 970 } });
  try {
    await page.goto(`/mesas/${mesa.id}`);
    await expect(page.getByLabel("Sucursal activa")).toBeVisible();

    await page.getByLabel("Sucursal activa").selectOption(segunda.id);
    await page.waitForURL((url) => url.pathname === "/mesas");
    await expect(page.getByLabel("Sucursal activa")).toHaveValue(segunda.id);
  } finally {
    await prisma.mesa.deleteMany({ where: { id: mesa.id } });
    await limpiar();
  }
});

test("si el rol no ve esa pantalla en la sucursal nueva (otro rol allá, o la capacidad apagada), el cambio termina en la pantalla de inicio", async ({ browser, baseURL, sucursalId }) => {
  // Otro rol en la sucursal nueva: «operador» no tiene reporte_costos.
  const conOperador = await usuarioConDosSucursales(browser, baseURL, sucursalId, "admin", "operador");
  try {
    await conOperador.page.goto("/reportes/costos");
    await expect(conOperador.page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();
    await conOperador.page.getByLabel("Sucursal activa").selectOption(conOperador.segunda.id);
    await conOperador.page.waitForURL(/\/inicio$/);
    await expect(conOperador.page.getByLabel("Sucursal activa")).toHaveValue(conOperador.segunda.id);
  } finally {
    await conOperador.limpiar();
  }

  // La misma pantalla, con la capacidad apagada en la sucursal nueva.
  const conCapacidad = await usuarioConDosSucursales(browser, baseURL, sucursalId, "admin", "admin");
  try {
    await prisma.capacidadSucursal.create({ data: { accionClave: "precio_local", sucursalId: conCapacidad.segunda.id, habilitado: false } });
    await conCapacidad.page.goto("/movimientos/precio-local");
    await expect(conCapacidad.page.getByLabel("Sucursal activa")).toBeVisible();
    await conCapacidad.page.getByLabel("Sucursal activa").selectOption(conCapacidad.segunda.id);
    await conCapacidad.page.waitForURL(/\/inicio$/);
  } finally {
    await conCapacidad.limpiar();
  }
});

test("desde el panel de inicio, el cambio de sucursal sigue en el panel de inicio", async ({ browser, baseURL, sucursalId }) => {
  const { page, segunda, limpiar } = await usuarioConDosSucursales(browser, baseURL, sucursalId, "admin", "admin");
  try {
    await page.goto("/inicio");
    await page.getByLabel("Sucursal activa").selectOption(segunda.id);
    await expect(page.getByRole("heading", { level: 1, name: /E2E Cambio Sucursal/ })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/inicio");
  } finally {
    await limpiar();
  }
});
