import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular } from "./fixtures/movil";

import { crearCategoriaDeTest, limpiarCategoriasDeTest } from "../setup/categoria-de-prueba";
/**
 * MOVIL: Catálogo › Maestros › Categorías a 375 × 812. Defecto de las capturas del 2026-11-15: el nombre largo de una categoría se pisaba con la columna «Activa». En celular cada categoría es una
 * tarjeta (el nombre se parte en varias líneas y «Activa» queda debajo, sin superponerse); desde 640 px, la tabla de siempre.
 *
 * Mide, no mira: la página no se sale por la derecha, el nombre largo queda ENTERO dentro de su tarjeta, el valor de «Activa» queda debajo del nombre (cajas que no se superponen), los botones «Desactivar» miden >= 44 px;
 * y en escritorio el nombre y «Activa» son columnas distintas, sin superponerse.
 */
const NOMBRE_LARGO = `E2E Categoría con un nombre larguísimo ${Date.now()} ${"Superlativa".repeat(4)}`;

const seSuperponen = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

test.beforeEach(async () => {
  await crearCategoriaDeTest(prisma, { nombre: NOMBRE_LARGO });
});
test.afterEach(async () => {
  await limpiarCategoriasDeTest(prisma, { nombre: NOMBRE_LARGO });
});

test("categorías en celular (375 px): el nombre largo se parte y no se pisa con «Activa»", async ({ paginaAutenticada: page }) => {
  await fijarCelular(page);
  await page.goto("/catalogo/categorias");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Categorías");
  await page.evaluate(() => document.fonts.ready);
  await expectSinDesborde(page, "categorías");
  await capturar(page, "categorias");

  const tarjeta = page.getByRole("list", { name: "Tabla de categorías" }).getByRole("listitem").filter({ hasText: NOMBRE_LARGO });
  await expect(tarjeta).toHaveCount(1);
  const caja = (await tarjeta.boundingBox())!;
  const nombre = (await tarjeta.locator("p").first().boundingBox())!;
  const activa = (await tarjeta.locator("dd").first().boundingBox())!;
  expect.soft(nombre.x + nombre.width, "el nombre queda dentro de su tarjeta").toBeLessThanOrEqual(caja.x + caja.width + 1);
  expect.soft(nombre.height, "el nombre se partió en más de una línea").toBeGreaterThan(30);
  expect.soft(seSuperponen(nombre, activa), "el nombre y «Activa» no se superponen").toBe(false);
  expect.soft(activa.y, "«Activa» queda debajo del nombre").toBeGreaterThanOrEqual(nombre.y + nombre.height - 1);

  await expectObjetivosTactiles(tarjeta.getByRole("button"), "categorías: botón de la tarjeta", { alto: 44 });
});

test("categorías en escritorio: el nombre y «Activa» son columnas distintas y no se superponen", async ({ paginaAutenticada: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/catalogo/categorias");
  const fila = page.getByRole("region", { name: "Tabla de categorías" }).getByRole("row").filter({ hasText: NOMBRE_LARGO });
  await expect(fila).toHaveCount(1);
  const celdas = await fila.getByRole("cell").all();
  const nombre = (await celdas[0]!.boundingBox())!;
  const activa = (await celdas[1]!.boundingBox())!;
  expect.soft(seSuperponen(nombre, activa), "las celdas no se superponen").toBe(false);
  expect.soft(activa.x, "«Activa» queda a la derecha del nombre").toBeGreaterThanOrEqual(nombre.x + nombre.width - 1);
});
