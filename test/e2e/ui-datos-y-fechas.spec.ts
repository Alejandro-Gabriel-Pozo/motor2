import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

/**
 * `TablaDeDatos` y `RangoDeFechas` (`src/ui/componentes/`) en un navegador real, con los estilos reales de la aplicación. Son componentes de SERVIDOR sin JavaScript, así que no hace
 * falta una ruta que los use (agregar una ruta cambiaría los archivos de comparación congelados): se dibuja su HTML —el mismo que mandaría el servidor— dentro de la página de
 * login, que ya trae la hoja de estilos de la app (el build la genera leyendo `src/ui`). Se afirma:
 *  - en celular (375 px): tarjetas, sin tabla, sin scroll horizontal de página, y las fechas a 44 px de alto y en una columna;
 *  - en PC (1024 px): tabla con sus filas y encabezados, sin tarjetas, y las dos fechas lado a lado;
 *  - axe sin violaciones en las dos medidas, en modo claro y oscuro;
 *  - el estado vacío ofrece el próximo paso.
 */
/** El HTML lo dibuja `scripts/renderizar-ui-para-e2e.ts` en otro proceso (Playwright transforma el JSX de lo que importa; ver ese script). */
const { conFilas, vacia } = JSON.parse(execFileSync("npx", ["tsx", "scripts/renderizar-ui-para-e2e.ts"], { encoding: "utf8" })) as { conFilas: string; vacia: string };

async function montar(page: Page, html: string = conFilas) {
  await page.goto("/login"); // trae la hoja de estilos real de la aplicación
  await page.evaluate((html) => {
    document.body.innerHTML = html;
  }, html);
}

const sinScrollHorizontal = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("celular (375 px): tarjetas en vez de tabla, sin scroll horizontal, y fechas de 44 px en una columna", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await montar(page);

  await expect(page.getByRole("list", { name: "Compras registradas" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0); // oculta con CSS: sale del árbol de accesibilidad
  const tarjetas = page.getByRole("list", { name: "Compras registradas" }).getByRole("listitem");
  await expect(tarjetas).toHaveCount(3);
  await expect(tarjetas.nth(0)).toContainText("Molino Sur");
  await expect(tarjetas.nth(0)).toContainText("Fecha");
  await expect(tarjetas.nth(0)).toContainText("$ 1.200,00");
  await expect(tarjetas.nth(0), "la columna «solo en tabla» no va a la tarjeta").not.toContainText("pagada");
  expect(await sinScrollHorizontal(page), "scroll horizontal de página con el proveedor de nombre largo").toBe(true);

  for (const nombre of ["Desde", "Hasta"]) {
    const campo = page.getByLabel(nombre, { exact: true });
    await expect(campo).toHaveAttribute("type", "date");
    expect((await campo.boundingBox())!.height, `alto táctil de «${nombre}»`).toBeGreaterThanOrEqual(44);
  }
  const desde = await page.getByLabel("Desde", { exact: true }).boundingBox();
  const hasta = await page.getByLabel("Hasta", { exact: true }).boundingBox();
  expect(hasta!.y, "en celular «Hasta» queda debajo de «Desde»").toBeGreaterThan(desde!.y + desde!.height - 1);
});

test("PC (1024 px): tabla con sus filas y encabezados, sin tarjetas, y las dos fechas lado a lado", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await montar(page);

  const tabla = page.getByRole("table", { name: "Compras registradas" });
  await expect(tabla).toBeVisible();
  await expect(page.getByRole("list", { name: "Compras registradas" })).toHaveCount(0);
  await expect(tabla.getByRole("columnheader")).toHaveText(["Proveedor", "Fecha", "Total", "Estado"]);
  await expect(tabla.getByRole("row")).toHaveCount(4); // encabezado + 3 filas
  await expect(tabla.getByRole("cell", { name: "pagada" }).first()).toBeVisible();
  expect(await sinScrollHorizontal(page)).toBe(true);

  const desde = await page.getByLabel("Desde", { exact: true }).boundingBox();
  const hasta = await page.getByLabel("Hasta", { exact: true }).boundingBox();
  expect(Math.abs(hasta!.y - desde!.y), "en PC están en la misma fila").toBeLessThan(2);
  expect(hasta!.x).toBeGreaterThan(desde!.x + desde!.width - 1);
});

for (const ancho of [375, 1024]) {
  test(`axe sin violaciones a ${ancho} px, en modo claro y oscuro`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 800 });
    await montar(page);
    expect((await new AxeBuilder({ page }).analyze()).violations, "modo claro").toEqual([]);
    await page.emulateMedia({ colorScheme: "dark" });
    expect((await new AxeBuilder({ page }).analyze()).violations, "modo oscuro emulado").toEqual([]);
  });
}

test("sin filas: el estado vacío dice qué hacer y no queda ni tabla ni lista", async ({ page }) => {
  await montar(page, vacia);
  await expect(page.getByRole("status")).toHaveText("Todavía no hay compras. Registrá la primera desde Movimientos.");
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("list")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
