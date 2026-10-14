import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { sembrarGrupo } from "./fixtures/opciones";
import { capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * MOVIL (pase visual en celular, 375 × 812): «Opciones agotadas». El resultado de tocar una píldora («Papas fritas quedó agotada…») y su botón «Deshacer» salían ARRIBA de la lista:
 * en una lista larga, quien tocaba una opción lejos (abajo) no los veía sin volver a subir. Ahora van pegados al borde de abajo de la pantalla (`role="status"`).
 *
 * Mide, no mira: con 30 opciones (la lista mide varias pantallas), toca la ÚLTIMA y comprueba que el aviso y «Deshacer» quedan DENTRO del viewport sin hacer scroll, que «Deshacer»
 * mide >= 44 px y funciona, y que la página no se sale por la derecha. Lo sembrado de opciones no se borra (ver `fixtures/opciones.ts`).
 */
test("opciones agotadas en celular: tocar una opción lejos deja el aviso y «Deshacer» a la vista, pegados abajo", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const nombres = Array.from({ length: 30 }, (_, i) => `Opción móvil ${String(i + 1).padStart(2, "0")} ${m}`);
  const grupo = await sembrarGrupo({ nombre: `E2E Grupo agotadas móvil ${m}`, tipo: "VARIANTE", cantidadMinima: 1, cantidadMaxima: 1, marca: m, opciones: nombres.map((nombre) => ({ nombre })) });
  await fijarCelular(page);
  await page.goto("/movimientos/opciones-agotadas");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Opciones agotadas en");
  await expectSinDesborde(page, "opciones agotadas");
  await capturar(page, "opciones-agotadas-inicial");

  const ultima = nombres[nombres.length - 1]!;
  const pildora = page.locator(`[data-opcion-sucursal='${ultima}']`).getByRole("button", { name: `${ultima}: Disponible` });
  await pildora.scrollIntoViewIfNeeded();
  const alto = await page.evaluate(() => window.innerHeight);
  expect(await page.evaluate(() => window.scrollY), "la opción tocada está lejos del principio de la pantalla").toBeGreaterThan(alto);
  await pildora.click();

  // El aviso y «Deshacer» están a la vista, SIN volver a hacer scroll.
  const aviso = page.getByRole("status").filter({ hasText: "quedó agotada" });
  await expect(aviso).toBeVisible();
  await expect(aviso, "el aviso del resultado, dentro del viewport").toBeInViewport({ ratio: 1 });
  const deshacer = aviso.getByRole("button", { name: "Deshacer" });
  await expect(deshacer, "«Deshacer», dentro del viewport").toBeInViewport({ ratio: 1 });
  await expectObjetivosTactiles(deshacer, "«Deshacer»");
  await expectSinDesborde(page, "opciones agotadas con el aviso");
  await capturar(page, "opciones-agotadas-con-aviso-abajo");
  expect((await new AxeBuilder({ page }).analyze()).violations, "opciones agotadas con el aviso en celular").toEqual([]);

  // Y «Deshacer» la vuelve a prender, también desde ahí.
  await deshacer.click();
  await expect(page.locator(`[data-opcion-sucursal='${ultima}']`).getByRole("button", { name: `${ultima}: Disponible` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deshacer" })).toHaveCount(0);
  expect(await prisma.opcionApagadaEnSucursal.findMany({ where: { opcionId: grupo.opciones[ultima]!.opcionId, sucursalId }, select: { apagada: true } })).toEqual([{ apagada: false }]);
});
