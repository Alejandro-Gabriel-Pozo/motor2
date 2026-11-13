import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { INSTALACION_A, ingresarALaConsola, leerDeLaBase } from "./fixtures/consola";
import { capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * MOVIL — consola de plataforma a 375 px, defecto 1 del ensayo general del 2026-11-13: la tarjeta «Empresas · <instalación>» se salía 86 px por la derecha, la tabla se apretaba (CUIT en 3
 * renglones, «Ver …» en 4) y los enlaces salían en el azul del navegador. Ahora la tarjeta cabe, cada empresa es una tarjeta con sus datos rotulados, los enlaces llevan el color de la
 * app y miden 44 px de alto.
 *
 * Mide, no mira: sin desborde horizontal, la tarjeta cabe en el ancho, el CUIT en un renglón, enlaces de 44 px, enlaces con el color del sistema (no el azul por defecto) y axe en 0.
 */
const CONSOLA = process.env.MOTOR2_E2E_URL_PLATAFORMA;
test.skip(!CONSOLA, "sin la consola de plataforma (MOTOR2_E2E_PLATAFORMA_DATABASE_URL) no hay nada que probar");

const EMPRESA = "movil-consola-e2e";

test.beforeAll(async () => {
  await leerDeLaBase(async (db) => {
    await db.empresa.deleteMany({ where: { id: EMPRESA } });
    await db.empresa.create({ data: { id: EMPRESA, nombre: "Empresa B de prueba móvil", slug: EMPRESA, zonaHoraria: "America/Argentina/Buenos_Aires", moneda: "ARS", estado: "ACTIVE", cuit: "30714589642" } });
  });
});

test.afterAll(async () => {
  await leerDeLaBase(async (db) => {
    await db.empresa.deleteMany({ where: { id: EMPRESA } });
  });
});

test("consola en celular (375 px): la tarjeta cabe, cada empresa es una tarjeta legible, enlaces del color de la app y de 44 px", async ({ page }) => {
  await fijarCelular(page);
  await ingresarALaConsola(page, CONSOLA!);
  await page.goto(`${CONSOLA}/instalaciones/${INSTALACION_A}/empresas`);
  await expect(page.getByRole("heading", { name: /Empresas · / })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Ver Empresa B de prueba móvil/ })).toBeVisible();
  await expectSinDesborde(page, "consola, empresas");
  await capturar(page, "consola-empresas");

  const tarjeta = page.locator("section.tarjeta").first();
  const caja = (await tarjeta.boundingBox())!;
  expect.soft(caja.x + caja.width, "la tarjeta cabe en el ancho de la pantalla").toBeLessThanOrEqual(375);

  // El CUIT en un solo renglón (antes: 3).
  const celdaCuit = page.locator("td[data-etiqueta='CUIT']").first();
  const letra = await celdaCuit.evaluate((n) => parseFloat(getComputedStyle(n).lineHeight));
  const etiqueta = await celdaCuit.evaluate((n) => parseFloat(getComputedStyle(n, "::before").height) || 0);
  expect.soft((await celdaCuit.boundingBox())!.height - etiqueta, "el CUIT ocupa un solo renglón").toBeLessThanOrEqual(letra * 1.5 + 12);

  await expectObjetivosTactiles(page.locator("section.tarjeta a:visible"), "consola: enlaces");
  const color = await page.getByRole("link", { name: /^Ver Hoteles/ }).evaluate((n) => getComputedStyle(n).color);
  expect(color, "el enlace no es el azul por defecto del navegador").not.toBe("rgb(0, 0, 238)");
  expect((await new AxeBuilder({ page }).analyze()).violations, "axe en la consola").toEqual([]);
});
