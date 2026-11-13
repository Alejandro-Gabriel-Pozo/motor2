import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * MOVIL — encabezado general del panel en celular (375 × 812), defecto 4 del ensayo general del 2026-11-13: el correo largo se partía en dos renglones, quedaba un «·» huérfano arriba a
 * la derecha del selector de sucursal y «Salir» caía solo en un tercer renglón. Ahora: ☰ y dólar arriba; el correo en su renglón (una sola línea, con «…» si no entra); sucursal y rol en el
 * siguiente; «Salir» a la derecha del último renglón y de 44 × 44 px.
 *
 * Mide, no mira: el correo ocupa UN renglón, la sucursal y el rol quedan en el mismo renglón, ningún texto empieza con un «·», «Salir» mide 44 × 44, sin desborde y axe en 0.
 */
test("encabezado en celular (375 px): el correo en un solo renglón, sin «·» huérfano, «Salir» de 44 × 44 y sin desborde", async ({ paginaAutenticada: page }) => {
  await fijarCelular(page);
  await page.goto("/catalogo/opciones");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const encabezado = page.locator("header").first();
  await expectSinDesborde(page, "pantalla con el encabezado");
  await capturar(page, "encabezado");

  const email = encabezado.locator("span[title]").first();
  const cajaEmail = (await email.boundingBox())!;
  const letra = await email.evaluate((n) => parseFloat(getComputedStyle(n).lineHeight));
  expect.soft(cajaEmail.height, "el correo ocupa un solo renglón").toBeLessThanOrEqual(letra + 1);

  const salir = encabezado.getByRole("button", { name: "Salir" });
  await expectObjetivosTactiles(salir, "encabezado: «Salir»");
  const cajaSalir = (await salir.boundingBox())!;
  expect.soft(cajaSalir.x + cajaSalir.width, "«Salir» queda dentro de la pantalla").toBeLessThanOrEqual(375);
  const cajaRol = (await encabezado.getByText(/^· /).boundingBox())!;
  expect.soft(Math.abs(cajaSalir.y + cajaSalir.height / 2 - (cajaEmail.y + (cajaRol.y + cajaRol.height - cajaEmail.y) / 2)), "«Salir» queda a la altura del bloque de correo, sucursal y rol, no solo en un renglón de más").toBeLessThan(30);

  // Ningún renglón del encabezado empieza con un «·» suelto: el separador va pegado al texto que sigue.
  const sueltos = await encabezado.evaluate((h) => Array.from(h.querySelectorAll("span")).filter((s) => s.children.length === 0 && s.textContent?.trim() === "·").length);
  expect.soft(sueltos, "«·» huérfano").toBe(0);

  expect((await new AxeBuilder({ page }).analyze()).violations, "axe en el encabezado").toEqual([]);
});

test("encabezado en escritorio (1280 px): todo en una línea, como siempre", async ({ paginaAutenticada: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/catalogo/opciones");
  const encabezado = page.locator("header").first();
  await expect(encabezado.getByRole("button", { name: "Salir" })).toBeVisible();
  const alto = (await encabezado.boundingBox())!.height;
  expect(alto, "el encabezado de escritorio mide una línea").toBeLessThanOrEqual(64);
});
