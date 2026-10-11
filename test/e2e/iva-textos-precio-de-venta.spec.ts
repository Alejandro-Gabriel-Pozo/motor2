import { test, expect } from "./fixtures/auth";

/**
 * IVA-2: el precio de venta es el de la carta, CON IVA incluido (y el costo también es lo pagado). Los textos de ayuda no pueden decir que es
 * «neto» o «sin IVA»: el de la pantalla del objetivo (`/catalogo/margen-objetivo`) y el del tooltip de la columna «Precio para el objetivo» de
 * `/reportes/costos` (ícono «?» con `role="img"` y `title`; la tabla dibuja los encabezados aunque no tenga filas, así que no hace falta sembrar).
 */

test("catalogo/margen-objetivo: el texto dice que el precio de venta es el de la carta, con IVA incluido, y no menciona «sin IVA»", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/margen-objetivo");
  await expect(page.getByRole("heading", { name: "Margen objetivo (food cost)" })).toBeVisible();
  await expect(page.getByText(/del precio de venta \(el de la carta, con IVA incluido\)/)).toBeVisible();
  await expect(page.getByText(/sin IVA/)).toHaveCount(0);
});

test("reportes/costos: la ayuda de «Precio para el objetivo» dice que es un precio con IVA incluido, como el precio de venta, y no menciona «sin IVA»", async ({ paginaAutenticada: page }) => {
  await page.goto("/reportes/costos");
  await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /Precio para el objetivo/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /con IVA incluido, igual que el precio de venta/ })).toHaveCount(1);
  await expect(page.getByRole("img", { name: /sin IVA/ })).toHaveCount(0);
  await expect(page.getByText(/sin IVA/)).toHaveCount(0);
});
