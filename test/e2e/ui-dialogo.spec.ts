import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";

/**
 * El diálogo del sistema de diseño (`src/ui/componentes/superposiciones/dialogo.tsx`, sobre el `<dialog>` nativo) en un navegador real, a través del único consumidor que hoy lo usa:
 * `components/modal.tsx` («+ Nueva receta» en /catalogo/recetas, que lo comparten otras 4 pantallas). El `Modal` anterior no tenía rol de diálogo, ni Escape, ni foco atrapado, ni
 * versión para celular (informe de estructura y responsive, §1 y §7.4). Lo que se afirma:
 *  - tiene rol de diálogo y nombre accesible, y la pantalla con el diálogo abierto no tiene violaciones de axe (claro y oscuro);
 *  - el resto de la página queda inerte: con Tab y Mayús+Tab el foco nunca llega a un elemento de atrás (puede pasar a la barra del navegador, como en cualquier diálogo nativo);
 *    con Escape se cierra y el foco vuelve al botón que lo abrió;
 *  - un clic en el fondo lo cierra, y uno adentro no;
 *  - en celular (390 px) es una hoja pegada abajo, que no agrega scroll horizontal (ni dentro ni a la página) y con el botón de cerrar de 44 px; en PC (1280 px) está centrado.
 */
// Sin recetas la pantalla ofrece «Crear la primera →»; con recetas, «+ Nueva receta»: es el mismo `Modal`, sirve cualquiera de los dos.
const ABRIR = /^(\+ Nueva receta|Crear la primera →)$/;

async function abrir(page: import("@playwright/test").Page) {
  await page.goto("/catalogo/recetas");
  const disparador = page.getByRole("button", { name: ABRIR });
  await disparador.click();
  const dialogo = page.getByRole("dialog", { name: "Nueva receta" });
  await expect(dialogo).toBeVisible();
  return { disparador, dialogo };
}

/** El foco está en el diálogo o fuera de la página (barra del navegador → `body`); nunca en un elemento del fondo, que queda inerte. */
const focoNoLlegaAlFondo = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const activo = document.activeElement;
    return !activo || activo === document.body || !!activo.closest("dialog[open]");
  });

test("el diálogo tiene rol y nombre, y la pantalla con el diálogo abierto no tiene violaciones de axe (claro y oscuro)", async ({ paginaAutenticada: page }) => {
  const { dialogo } = await abrir(page);
  await expect(dialogo.getByRole("heading", { name: "Nueva receta" })).toBeVisible();
  await expect(dialogo.getByRole("button", { name: "Cerrar" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "modo claro").toEqual([]);
  await page.emulateMedia({ colorScheme: "dark" });
  expect((await new AxeBuilder({ page }).analyze()).violations, "modo oscuro emulado").toEqual([]);
});

test("el fondo queda inerte (el foco no llega a nada de atrás) y Escape cierra el diálogo devolviendo el foco al botón que lo abrió", async ({ paginaAutenticada: page }) => {
  const { disparador, dialogo } = await abrir(page);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await focoNoLlegaAlFondo(page), `Tab #${i + 1}: el foco llegó a un elemento del fondo`).toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await focoNoLlegaAlFondo(page), `Mayús+Tab #${i + 1}: el foco llegó a un elemento del fondo`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();
  await expect(disparador).toBeFocused();
});

test("el botón Cerrar y el clic en el fondo lo cierran; un clic adentro no", async ({ paginaAutenticada: page }) => {
  const { disparador, dialogo } = await abrir(page);
  await dialogo.getByRole("heading", { name: "Nueva receta" }).click();
  await expect(dialogo).toBeVisible();

  await dialogo.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialogo).toBeHidden();
  await expect(disparador).toBeFocused();

  await disparador.click();
  await expect(dialogo).toBeVisible();
  await page.mouse.click(4, 4); // esquina de la pantalla: el fondo
  await expect(dialogo).toBeHidden();
});

test("al cerrarse y volverse a abrir, el diálogo arranca limpio (los hijos se montan solo mientras está abierto)", async ({ paginaAutenticada: page }) => {
  const { dialogo } = await abrir(page);
  const buscador = dialogo.getByRole("combobox");
  await buscador.fill("zzz-no-existe");
  await expect(buscador).toHaveValue("zzz-no-existe");
  await page.keyboard.press("Escape");
  await expect(dialogo).toBeHidden();
  await page.getByRole("button", { name: ABRIR }).click();
  await expect(dialogo.getByRole("combobox")).toHaveValue("");
});

test("en celular es una hoja pegada abajo, sin scroll horizontal y con el cierre de 44 px; en PC está centrado", async ({ paginaAutenticada: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // La PÁGINA de fondo puede tener ya su propio scroll horizontal (menú lateral fijo de 14 rem y tablas anchas de /catalogo/recetas, que aparecen cuando hay recetas cargadas por otros specs:
  // brecha de responsive de las pantallas existentes, PENDIENTE-PARA-LA-UNION §3.5). Lo que este test afirma es que el DIÁLOGO no agrega ancho: se mide antes y después de abrirlo.
  await page.goto("/catalogo/recetas");
  const anchoAntes = await page.evaluate(() => document.documentElement.scrollWidth);
  const { dialogo } = await abrir(page);
  const caja = await dialogo.boundingBox();
  expect(caja).not.toBeNull();
  expect(Math.round(caja!.y + caja!.height), "la hoja termina en el borde inferior de la pantalla").toBe(844);
  expect(caja!.width, "ocupa el ancho de la pantalla (menos nada)").toBeGreaterThanOrEqual(388);
  // Es `position: fixed`: aunque se pase del borde no agranda el scroll de la página, así que el desborde se mide en la propia caja.
  expect(caja!.x, "la hoja no se sale por la izquierda").toBeGreaterThanOrEqual(-1);
  expect(caja!.x + caja!.width, "la hoja no se sale por la derecha").toBeLessThanOrEqual(391);
  const cierre = await dialogo.getByRole("button", { name: "Cerrar" }).boundingBox();
  expect(cierre!.height).toBeGreaterThanOrEqual(44);
  expect(cierre!.width).toBeGreaterThanOrEqual(44);
  expect(await dialogo.evaluate((el) => el.scrollWidth <= el.clientWidth), "scroll horizontal dentro del diálogo").toBe(true);
  expect(
    await page.evaluate((antes) => document.documentElement.scrollWidth <= Math.max(window.innerWidth, antes), anchoAntes),
    `el diálogo agregó ancho a la página (antes: ${anchoAntes} px)`,
  ).toBe(true);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole("button", { name: ABRIR }).click();
  const centrado = await page.getByRole("dialog", { name: "Nueva receta" }).boundingBox();
  expect(centrado!.y, "separado del borde superior").toBeGreaterThan(20);
  expect(centrado!.y + centrado!.height, "separado del borde inferior").toBeLessThan(780);
  expect(Math.abs(centrado!.x + centrado!.width / 2 - 640), "centrado horizontalmente").toBeLessThan(2);
});
