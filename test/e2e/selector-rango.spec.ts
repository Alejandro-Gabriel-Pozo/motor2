import { test, expect } from "./fixtures/auth";

/**
 * SelectorRango (src/components/selector-rango.tsx) — decisión del usuario, 2026-09-21 (docs/planes-demo-y-claridad-reportes-
 * 2026-09-21.md §1): el default de los reportes pasa de "mes en curso" a "Últimos 30 días", con "Mes en curso" y "Fechas
 * personalizadas" como alternativas. Se prueba en /reportes/periodo, una de las cinco pantallas que lo comparten.
 */
test("cambiar la opción del selector cambia el rango efectivo (URL y rótulo), y «Fechas personalizadas» recién ahí muestra los inputs de fecha", async ({
  paginaAutenticada: page,
}) => {
  const hoyISO = new Date().toISOString().slice(0, 10);

  await page.goto("/reportes/periodo");
  await expect(page.getByRole("heading", { name: "Reporte por período" })).toBeVisible();
  await expect(page.getByLabel("Rango")).toHaveValue("30d");
  // Sin `?rango=` en la URL (default implícito): no se dibujan inputs de fecha en este estado.
  await expect(page.locator('input[name="desde"]')).toHaveCount(0);
  await expect(page.getByText(`al ${hoyISO}`)).toBeVisible();

  // "Mes en curso": cambia la URL y el rótulo del rango, sin mostrar inputs de fecha.
  await page.getByLabel("Rango").selectOption("mes");
  await page.getByRole("button", { name: "Actualizar" }).click();
  await expect(page).toHaveURL(/rango=mes/);
  await expect(page.getByLabel("Rango")).toHaveValue("mes");
  const primerDiaDelMes = `${hoyISO.slice(0, 8)}01`;
  await expect(page.getByText(`Del ${primerDiaDelMes} al ${hoyISO}`)).toBeVisible();
  await expect(page.locator('input[name="desde"]')).toHaveCount(0);

  // "Fechas personalizadas": el primer submit (sin haber tocado fechas todavía) muestra los inputs, prellenados.
  await page.getByLabel("Rango").selectOption("personalizado");
  await page.getByRole("button", { name: "Actualizar" }).click();
  await expect(page).toHaveURL(/rango=personalizado/);
  const desde = page.getByLabel("Desde", { exact: true });
  const hasta = page.getByLabel("Hasta", { exact: true });
  await expect(desde).toBeVisible();
  await expect(hasta).toBeVisible();

  // Cambiar las fechas a mano y volver a enviar: la URL lleva `desde`/`hasta`, no `rango` (mismo comportamiento que antes del selector).
  await desde.fill("2026-08-01");
  await hasta.fill("2026-08-10");
  await page.getByRole("button", { name: "Actualizar" }).click();
  await expect(page).toHaveURL(/desde=2026-08-01/);
  await expect(page).toHaveURL(/hasta=2026-08-10/);
  await expect(page.getByLabel("Rango")).toHaveValue("personalizado");
  await expect(desde).toHaveValue("2026-08-01");
  await expect(hasta).toHaveValue("2026-08-10");
});
