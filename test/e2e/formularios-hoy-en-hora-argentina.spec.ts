import { test, expect } from "./fixtures/auth";

/**
 * El «hoy» que proponen los formularios es el día de Argentina, no el de UTC. Desde las 21:00 argentinas UTC ya está en el día siguiente: con
 * `new Date().toISOString().slice(0, 10)` los formularios de movimiento y de venta proponían «mañana». Ningún otro test ve la hora argentina
 * (Playwright no fija la zona y el CI corre en UTC), así que el navegador se pone en `America/Argentina/Buenos_Aires` y el reloj en las
 * 22:00 del 30/9 (01:00 UTC del 1/10): el día propuesto tiene que ser el 30/9.
 *
 * `setFixedTime` fija solo `Date`/`Date.now()` del navegador (los timers siguen andando). La fecha propuesta se asienta al hidratar el
 * formulario en el cliente, por eso la comprobación espera con `toHaveValue`.
 */
test.use({ timezoneId: "America/Argentina/Buenos_Aires" });

const DIA_ARGENTINO = "2026-09-30";

test.beforeEach(async ({ paginaAutenticada: page }) => {
  await page.clock.setFixedTime(new Date("2026-09-30T22:00:00-03:00"));
});

test("el formulario de venta propone el día de hoy argentino a las 22:00, no mañana", async ({ paginaAutenticada: page }) => {
  await page.goto("/movimientos/venta");
  await expect(page.getByLabel(/^Fecha(?: \*)?$/)).toHaveValue(DIA_ARGENTINO);
});

test("el formulario de movimiento (merma) propone el día de hoy argentino a las 22:00, no mañana", async ({ paginaAutenticada: page }) => {
  await page.goto("/movimientos/merma");
  await expect(page.getByLabel(/^Fecha(?: \*)?$/)).toHaveValue(DIA_ARGENTINO);
});
