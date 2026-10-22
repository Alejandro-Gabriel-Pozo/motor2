import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Un fallo al armar una pantalla muestra nuestra pantalla de error (dentro del menú, con «Reintentar» y la salida al inicio) y no
 * la página genérica de Next. El fallo es real y no hay código de prueba en la aplicación: la zona horaria de la empresa es un dato
 * de la base (`Empresa.zonaHoraria`) y las pantallas que cortan días la leen con `Intl`, que lanza un `RangeError` con una zona que
 * no existe. Para esta prueba se la rompe en la base y se la restaura al terminar (los specs corren de a uno, con `workers: 1`).
 *
 * Antes el fallo era una fecha inválida en la URL (primero del reporte por período y después de Consignación); cada pantalla fue
 * validando su fecha (lote 6.33) y ya no falla, así que el fallo tiene que ser uno que ninguna validación de la URL pueda apagar.
 */
const ZONA_QUE_NO_EXISTE = "No/Existe";

test("si falla el armado de una pantalla, se ve el error propio dentro del menú y se puede salir", async ({ paginaAutenticada: page }) => {
  const empresa = await prisma.empresa.findFirstOrThrow({ where: { estado: "ACTIVE", slug: "e2e" }, select: { id: true, zonaHoraria: true } });
  await prisma.empresa.update({ where: { id: empresa.id }, data: { zonaHoraria: ZONA_QUE_NO_EXISTE } });
  try {
    await page.goto("/reportes/categorias");

    await expect(page.getByRole("heading", { name: "Algo falló al abrir esta pantalla" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
    // Sigue el menú de la aplicación: solo se cayó el contenido de la pantalla.
    await expect(page.getByRole("link", { name: "Costos y márgenes" })).toBeVisible();

    // Con la zona rota, reintentar vuelve a fallar: sigue la pantalla de error, no queda colgada ni en blanco.
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByRole("heading", { name: "Algo falló al abrir esta pantalla" })).toBeVisible();

    await page.getByRole("link", { name: "Ir al inicio" }).click();
    await page.waitForURL(/\/inicio$/);
    await expect(page.getByRole("heading", { name: "Algo falló al abrir esta pantalla" })).toHaveCount(0);
  } finally {
    await prisma.empresa.update({ where: { id: empresa.id }, data: { zonaHoraria: empresa.zonaHoraria } });
  }
});
