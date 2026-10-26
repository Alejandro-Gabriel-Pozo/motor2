import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { abrirComoRol } from "./fixtures/rol-pos";

/**
 * Fase 7, P4: la pantalla «Registrar movimiento» (`/movimientos`) y la fila «Qué movimiento registrar» (pestañas-enlace) que comparten los procesos del selector y Reclasificar.
 *  - El admin ve las 8 pestañas; en la pantalla de un proceso del selector el título lleva «Registrar movimiento · {proceso}» y la pestaña de ese proceso está marcada (`aria-current`).
 *  - Quien solo tiene `stock_reclasificar` ve UNA pestaña; lleva a `/stock/reclasificar`, que muestra la fila con la actual marcada.
 *  - Quien solo tiene `proceso_merma` (un proceso directo, que no está en el selector) recibe «No tenés permiso» en `/movimientos`, y `/movimientos/merma` no tiene fila.
 * Cada pantalla se protege con su propia clave: la fila solo ofrece lo que el rol puede ver, pero abrir una ruta a mano sin el permiso sigue negándose.
 */

const fila = (page: Page) => page.getByRole("navigation", { name: "Qué movimiento registrar" });

test("el admin ve las 8 pestañas en /movimientos y la del proceso abierto marcada en cada pantalla", async ({ paginaAutenticada: page }) => {
  await page.goto("/movimientos");
  await expect(page.getByRole("heading", { level: 1, name: "Registrar movimiento" })).toBeVisible();
  await expect(page.getByText("Elegí arriba qué movimiento querés registrar.")).toBeVisible();
  await expect(fila(page).getByRole("link")).toHaveText([
    "Producción",
    "Consumo",
    "Ajuste",
    "Traslado entre depósitos",
    "Devolución al consignante",
    "Devolución de cliente",
    "Devolución a proveedor",
    "Reclasificar",
  ]);
  // En /movimientos todavía no hay ninguna elegida.
  await expect(fila(page).locator('[aria-current="page"]')).toHaveCount(0);

  await fila(page).getByRole("link", { name: "Ajuste" }).click();
  await expect(page).toHaveURL(/\/movimientos\/ajuste$/);
  await expect(page.getByRole("heading", { level: 1, name: "Registrar movimiento · Ajuste" })).toBeVisible();
  await expect(fila(page).getByRole("link")).toHaveCount(8);
  await expect(fila(page).locator('[aria-current="page"]')).toHaveText("Ajuste");

  await fila(page).getByRole("link", { name: "Reclasificar" }).click();
  await expect(page).toHaveURL(/\/stock\/reclasificar$/);
  await expect(page.getByRole("heading", { level: 1, name: "Registrar movimiento · Reclasificar" })).toBeVisible();
  await expect(fila(page).locator('[aria-current="page"]')).toHaveText("Reclasificar");
});

test("un rol con solo stock_reclasificar ve una pestaña, que lleva a Reclasificar con la fila y la actual marcada", async ({ browser, baseURL, sucursalId }) => {
  const rol = await abrirComoRol(browser, baseURL, sucursalId, { stock_reclasificar: "editar" });
  try {
    const page = rol.page;
    await page.goto("/movimientos");
    await expect(page.getByRole("heading", { level: 1, name: "Registrar movimiento" })).toBeVisible();
    await expect(fila(page).getByRole("link")).toHaveText(["Reclasificar"]);

    await fila(page).getByRole("link", { name: "Reclasificar" }).click();
    await expect(page).toHaveURL(/\/stock\/reclasificar$/);
    await expect(page.getByRole("heading", { level: 1, name: "Registrar movimiento · Reclasificar" })).toBeVisible();
    await expect(fila(page).getByRole("link")).toHaveCount(1);
    await expect(fila(page).locator('[aria-current="page"]')).toHaveText("Reclasificar");

    // Cada pantalla se protege con su clave: sin proceso_ajuste, abrir la ruta a mano se niega aunque la fila no la ofrezca.
    await page.goto("/movimientos/ajuste");
    await expect(page.getByText(/No tenés permiso/)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
  } finally {
    await rol.limpiar();
  }
});

test("un rol con solo proceso_merma no puede abrir /movimientos, y /movimientos/merma no tiene fila", async ({ browser, baseURL, sucursalId }) => {
  const rol = await abrirComoRol(browser, baseURL, sucursalId, { proceso_merma: "editar" });
  try {
    const page = rol.page;
    await page.goto("/movimientos");
    await expect(page.getByText(/No tenés permiso/)).toBeVisible();
    await expect(fila(page)).toHaveCount(0);

    await page.goto("/movimientos/merma");
    await expect(page.getByRole("heading", { level: 1, name: "Merma" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).not.toContainText("Registrar movimiento");
    await expect(fila(page)).toHaveCount(0);
  } finally {
    await rol.limpiar();
  }
});

test("Compra (directa) tampoco lleva la fila, y su título es el del proceso", async ({ paginaAutenticada: page }) => {
  await page.goto("/movimientos/compra");
  await expect(page.getByRole("heading", { level: 1, name: "Compra" })).toBeVisible();
  await expect(fila(page)).toHaveCount(0);
});
