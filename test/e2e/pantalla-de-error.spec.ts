import { test, expect } from "./fixtures/auth";

/**
 * Un fallo al armar una pantalla muestra nuestra pantalla de error (dentro del menú, con «Reintentar» y la salida al inicio) y no
 * la página genérica de Next. El fallo es real: el reporte por período recibe la fecha desde la URL y una fecha inválida hace que la
 * consulta a la base lance. (Si algún día ese reporte valida la fecha, hay que buscar otro fallo real para esta prueba.)
 */
test("si falla el armado de una pantalla, se ve el error propio dentro del menú y se puede salir", async ({ paginaAutenticada: page }) => {
  await page.goto("/reportes/periodo?desde=no-es-una-fecha");

  await expect(page.getByRole("heading", { name: "Algo falló al abrir esta pantalla" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  // Sigue el menú de la aplicación: solo se cayó el contenido de la pantalla.
  await expect(page.getByRole("link", { name: "Costos y márgenes" })).toBeVisible();

  // Con una fecha inválida, reintentar vuelve a fallar: sigue la pantalla de error, no queda colgada ni en blanco.
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("heading", { name: "Algo falló al abrir esta pantalla" })).toBeVisible();

  await page.getByRole("link", { name: "Ir al inicio" }).click();
  await page.waitForURL(/\/inicio$/);
  await expect(page.getByRole("heading", { name: "Algo falló al abrir esta pantalla" })).toHaveCount(0);
});
