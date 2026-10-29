import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { abrirComoRol } from "./fixtures/rol-pos";
import { capturar, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * MOVIL (pase visual en celular): el menú del panel. El menú lateral fijo de 224 px dejaba ~130 px al contenido en un celular (texto partido letra por letra). Variante A, aprobada por el
 * dueño: en celular (< 768 px) el menú NO se dibuja fijo; el encabezado lleva un botón ☰ («Abrir menú», 44 × 44) que abre un cajón por la izquierda con buscador «Buscar pantalla…», los
 * grupos como acordeones (uno abierto a la vez; el del ítem activo viene abierto) y filas de 46 px o más; en escritorio queda exactamente el menú lateral de siempre, con su «Ocultar menú».
 *
 * Mide, no mira: a 375 × 812 el menú lateral no está, el contenido usa todo el ancho, el ☰ mide 44 × 44, el cajón abre con el foco en el buscador y lo atrapa, la búsqueda sin
 * acentos ni mayúsculas encuentra «Recetas», tocar un ítem navega y cierra, Escape devuelve el foco al ☰, el fondo y ✕ cierran, no hay desborde horizontal y axe da 0 con el cajón abierto; un rol
 * con pocos permisos ve en el cajón solo lo que el servidor le ofrece; a 1280 × 800 el menú lateral sigue fijo (224 px), sin ☰, y «Ocultar menú» sigue andando.
 */
test("celular (375 px): el menú no está fijo, el contenido usa todo el ancho y el ☰ abre un cajón con buscador, acordeones y foco atrapado", async ({ paginaAutenticada: page }) => {
  await fijarCelular(page);
  await page.goto("/catalogo/opciones");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const abrir = page.getByRole("button", { name: "Abrir menú" });
  await expect(abrir).toBeVisible();

  // Sin menú fijo: ni el lateral ni su control «Ocultar menú»; el contenido ocupa (casi) todo el ancho.
  await expect(page.locator("aside")).toBeHidden();
  await expect(page.getByRole("button", { name: /^(Ocultar|Mostrar) menú$/ })).toBeHidden();
  const main = (await page.locator("main").boundingBox())!;
  expect(main.width, "el contenido usa todo el ancho (antes: ~130 px)").toBeGreaterThanOrEqual(375 - 1);
  await expectSinDesborde(page, "pantalla con el menú cerrado");
  await capturar(page, "menu-cerrado");
  const caja = (await abrir.boundingBox())!;
  expect.soft(caja.width, "☰: ancho").toBeGreaterThanOrEqual(44);
  expect.soft(caja.height, "☰: alto").toBeGreaterThanOrEqual(44);

  // Abre el cajón: rol de diálogo con nombre, foco en el buscador, ~86 % del ancho, grupo activo abierto y el ítem activo marcado.
  await abrir.click();
  const cajon = page.getByRole("dialog", { name: "Menú" });
  await expect(cajon).toBeVisible();
  const buscador = cajon.getByRole("searchbox", { name: "Buscar pantalla" });
  await expect(buscador).toBeFocused();
  await expect(buscador).toHaveAttribute("placeholder", "Buscar pantalla…");
  const cajaCajon = (await cajon.boundingBox())!;
  expect(cajaCajon.width, "el cajón ocupa ~86 % del ancho").toBeGreaterThan(375 * 0.84);
  expect(cajaCajon.width).toBeLessThan(375 * 0.88);
  const cajaBuscador = (await buscador.boundingBox())!;
  expect.soft(cajaBuscador.height, "buscador: alto").toBeGreaterThanOrEqual(44);
  expect(await buscador.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), "buscador: 16 px (iOS no hace zoom)").toBeGreaterThanOrEqual(16);
  const grupoActivo = cajon.getByRole("button", { name: /Catálogo/ });
  await expect(grupoActivo).toHaveAttribute("aria-expanded", "true");
  await expect(cajon.getByRole("link", { name: /^Biblioteca de opciones/ })).toHaveAttribute("aria-current", "page");
  await capturar(page, "menu-abierto");

  // Un grupo abierto a la vez.
  const reportes = cajon.getByRole("button", { name: /Reportes/ });
  await reportes.click();
  await expect(reportes).toHaveAttribute("aria-expanded", "true");
  await expect(grupoActivo).toHaveAttribute("aria-expanded", "false");
  expect(await cajon.locator("button[aria-expanded=true]").count(), "un solo grupo abierto").toBe(1);
  await grupoActivo.click();
  for (const fila of await cajon.getByRole("link").all()) {
    if (!(await fila.isVisible())) continue;
    expect.soft((await fila.boundingBox())!.height, `fila «${(await fila.innerText()).trim()}»`).toBeGreaterThanOrEqual(46);
  }
  expect.soft((await cajon.getByRole("button", { name: "Cerrar menú" }).boundingBox())!.height, "✕: alto").toBeGreaterThanOrEqual(44);
  expect((await new AxeBuilder({ page }).analyze()).violations, "con el cajón abierto").toEqual([]);

  // Foco atrapado: recorriendo los controles del cajón con Tab, el foco sigue adentro. Desde la Fase 7 (DEC-13) Catálogo tiene 5 entradas y el cajón trae menos controles: se recorre desde el buscador
  // (el primero) hasta 12 controles sin pasar del último (al salir del último control de un <dialog> modal nativo, Chromium manda el foco a la interfaz del navegador, fuera del documento).
  const controlesDelCajon = await cajon.locator("a[href]:visible, button:visible, input:visible").count();
  await buscador.focus();
  for (let i = 0; i < Math.min(12, controlesDelCajon - 1); i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.querySelector("dialog[open]")?.contains(document.activeElement) ?? false), "el foco no sale del cajón").toBe(true);

  // Búsqueda: «recet» (y con otra grafía) encuentra «Recetas» con su grupo al costado; sin coincidencias, «Sin resultados».
  await buscador.fill("recet");
  const recetas = cajon.getByRole("link", { name: /^Recetas/ });
  await expect(recetas).toBeVisible();
  await expect(recetas).toContainText("Catálogo");
  await expect(cajon.getByRole("button", { name: /Catálogo/ }), "al buscar se ve la lista plana, no los grupos").toHaveCount(0);
  await buscador.fill("RÉCETAS");
  await expect(recetas).toBeVisible();
  await buscador.fill("zzzzqq");
  await expect(cajon.getByRole("status")).toHaveText("Sin resultados");
  await capturar(page, "menu-sin-resultados");
  await buscador.fill("recet");

  // Tocar el ítem navega y cierra el cajón.
  await recetas.click();
  await page.waitForURL((u) => u.pathname === "/catalogo/recetas");
  await expect(cajon).toBeHidden();

  // Escape cierra y devuelve el foco al ☰.
  await abrir.click();
  await expect(cajon).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(cajon).toBeHidden();
  await expect(abrir, "el foco vuelve al ☰").toBeFocused();

  // Tocar el fondo oscurecido cierra; ✕ también.
  await abrir.click();
  await expect(cajon).toBeVisible();
  await page.mouse.click(370, 400);
  await expect(cajon).toBeHidden();
  await abrir.click();
  await cajon.getByRole("button", { name: "Cerrar menú" }).click();
  await expect(cajon).toBeHidden();
  await expect(abrir).toBeFocused();
  await expectSinDesborde(page, "pantalla tras cerrar el menú");
});

test("celular: el cajón ofrece solo lo que el servidor le ofrece al rol (sin permiso no hay ítem)", async ({ browser, baseURL, sucursalId }) => {
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { opcion_apagar_en_sucursal: "ver" });
  try {
    await fijarCelular(page);
    await page.goto("/movimientos/opciones-agotadas");
    await page.getByRole("button", { name: "Abrir menú" }).click();
    const cajon = page.getByRole("dialog", { name: "Menú" });
    // DEC-24: Opciones agotadas es parte de la pestaña «Hoy» de la entrada «Carta», que es la que se marca (y la que ve quien solo agota opciones).
    await expect(cajon.getByRole("link", { name: /^Carta$/ })).toHaveAttribute("aria-current", "page");
    await cajon.getByRole("searchbox").fill("recet");
    await expect(cajon.getByRole("status")).toHaveText("Sin resultados");
    await cajon.getByRole("searchbox").fill("usuarios");
    await expect(cajon.getByRole("status")).toHaveText("Sin resultados");
  } finally {
    await limpiar();
  }
});

test("celular: el buscador del cajón sigue encontrando «Consumo» (ya no es un ítem: cuelga de «Registrar movimiento») solo si el rol puede verlo", async ({ browser, baseURL, sucursalId }) => {
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { proceso_consumo: "ver", proceso_merma: "ver" });
  try {
    await fijarCelular(page);
    await page.goto("/movimientos/merma");
    await page.getByRole("button", { name: "Abrir menú" }).click();
    const cajon = page.getByRole("dialog", { name: "Menú" });
    await cajon.getByRole("searchbox").fill("consumo");
    await expect(cajon.getByRole("link", { name: /^Consumo/ })).toHaveAttribute("href", "/movimientos/consumo");
    await cajon.getByRole("searchbox").fill("ajuste");
    await expect(cajon.getByRole("status")).toHaveText("Sin resultados");
  } finally {
    await limpiar();
  }
});

test("escritorio (1280 px): el menú lateral sigue fijo, sin ☰, y «Ocultar menú» sigue andando", async ({ paginaAutenticada: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/catalogo/opciones");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Abrir menú" })).toBeHidden();
  const lateral = page.locator("aside");
  await expect(lateral).toBeVisible();
  expect((await lateral.boundingBox())!.width, "el menú lateral mide 224 px, como siempre").toBeCloseTo(224, 0);
  await expect(lateral.getByRole("link", { name: /^Biblioteca de opciones/ })).toBeVisible();
  await page.getByRole("button", { name: "Ocultar menú" }).click();
  await expect.poll(async () => (await lateral.boundingBox())?.width ?? 0).toBe(0);
  await page.getByRole("button", { name: "Mostrar menú" }).click();
  await expect.poll(async () => (await lateral.boundingBox())?.width ?? 0).toBeCloseTo(224, 0);
});
