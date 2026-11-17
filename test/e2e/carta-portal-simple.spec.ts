import AxeBuilder from "@axe-core/playwright";
import type { Locator } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { COOKIE_PORTAL_SIMPLE_PRUEBA } from "../../src/lib/portal-simple-visible";

/** Espera a que React haya hidratado el elemento (mismo criterio que carta-tema-admin.spec.ts). */
async function esperarHidratado(el: Locator) {
  await expect.poll(() => el.evaluate((nodo) => Object.keys(nodo).some((k) => k.startsWith("__reactProps"))), { message: "elemento hidratado", timeout: 30_000 }).toBe(true);
}

/**
 * Pantalla SIMPLE de «Colores del portal» (docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md §2.3), de punta a punta, en los DOS estados del interruptor `portalSimpleVisible` (nace APAGADO). Apagado (sin la cookie de prueba, que SOLO vale en el servidor de los
 * e2e) la pestaña es la de siempre. Encendido (con la cookie) se recorre la pantalla a 375 y 1366 px con axe, incluido el RIESGO «portal vacío al crear la fila»: al guardar por primera vez se crea el portal nuevo y la carta pública SIGUE mostrando la sucursal publicada.
 * Este spec encendido es la CONDICIÓN para poner `PORTAL_SIMPLE_VISIBLE = true`.
 */
const EMPRESA = "e2e";

async function limpiar(sucursalId: string) {
  await prisma.portalTarjeta.deleteMany();
  await prisma.portalZona.deleteMany();
  await prisma.portalDeEmpresa.deleteMany();
  await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
}

test("apagado: la pestaña Portal es la de siempre (el editor completo, sin pantalla simple)", async ({ paginaAutenticada: page }) => {
  await page.goto("/carta/portal");
  await expect(page.getByRole("heading", { name: "Portal de sucursales", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Apariencia del portal", level: 2 })).toBeVisible();
  await expect(page.locator("[data-portal-simple]")).toHaveCount(0);
});

for (const ancho of [375, 1366]) {
  test(`encendido (${ancho} px): elegir fondos (uno se ajusta), guardar, la carta pública no queda vacía, recargar y ver lo guardado, con axe 0`, async ({ paginaAutenticada: page, sucursalId, baseURL }) => {
    const marca = `${Date.now()}-${ancho}`;
    await limpiar(sucursalId);
    await prisma.sucursalPublica.create({ data: { sucursalId, slug: `e2e-colores-${marca}`, publicada: true, etiqueta: `Colores ${marca}` } });
    await page.context().addCookies([{ name: COOKIE_PORTAL_SIMPLE_PRUEBA, value: "1", domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/" }]);
    await page.setViewportSize({ width: ancho, height: ancho === 375 ? 812 : 768 });
    try {
      await page.goto("/carta/portal");
      const pantalla = page.locator("[data-portal-simple]");
      await expect(pantalla).toBeVisible();
      await expect(page.getByRole("heading", { name: "Portal", level: 1 })).toBeVisible();
      const solapa = (nombre: string) => page.getByRole("group", { name: "Solapas" }).getByRole("button", { name: nombre, exact: true });
      // La vista previa es una solapa: el portal real, con el listado en tarjetas y «Ver carta».
      await solapa("Vista previa").click();
      await expect(page.locator("[data-vista-previa-colores-portal]")).toBeVisible();
      await expect(page.locator("[data-vista-previa-colores-portal]").getByText("Ver carta").first()).toBeVisible();
      await solapa("Colores").click();

      const encabezado = page.locator('[data-fondo-portal="encabezado"]');
      const pagina = page.locator('[data-fondo-portal="pagina"]');
      const azul = encabezado.getByLabel("Azul");
      await esperarHidratado(azul);
      await azul.check();
      await expect(page.locator('[data-aviso-fondo-ajustado="encabezado"]')).toHaveCount(0); // el azul de Pedernal se lee con texto blanco
      // Un gris medio no llega a 7:1 con ningún texto: la pantalla avisa cuál se usa en su lugar y que se guarda el elegido.
      await pagina.locator("summary").click();
      await pagina.getByRole("radio", { name: "Otro color" }).check();
      await pagina.getByRole("textbox", { name: "Otro color" }).fill("#777777");
      const aviso = page.locator('[data-aviso-fondo-ajustado="pagina"]');
      await expect(aviso).toContainText("El texto no se lee bien sobre este color");
      await expect(aviso).toContainText("del mismo tono, más oscuro. Contraste");
      // Mal escrito: el campo lo marca.
      await pagina.getByRole("textbox", { name: "Otro color" }).fill("gris");
      await expect(page.getByText("Escribí el color como #0e7490")).toBeVisible();
      await pagina.getByRole("textbox", { name: "Otro color" }).fill("#777777");
      await solapa("Portal").click();
      await pantalla.getByLabel("Título", { exact: true }).fill("Nuestros hoteles");
      await solapa("Colores").click();

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sin desborde horizontal").toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(await prisma.portalDeEmpresa.count(), "nada se guardó hasta el clic").toBe(0);

      const guardar = page.getByRole("button", { name: "Guardar", exact: true });
      const caja = await guardar.boundingBox();
      expect(caja?.height ?? 0, "objetivo táctil de 44 px").toBeGreaterThanOrEqual(44);
      expect(caja?.width ?? 0, "Guardar de ancho completo").toBeGreaterThanOrEqual(ancho * 0.8);
      await guardar.click();
      await expect(page.getByRole("status").filter({ hasText: "guardados" })).toBeVisible();

      const fila = await prisma.portalDeEmpresa.findFirstOrThrow();
      expect(fila).toMatchObject({ variante: "A", colorEncabezado: "#1f4e79", colorPagina: "#777777", colorDetras: null, titulo: "Nuestros hoteles", logoVisible: true, version: 1 });
      expect(await prisma.portalTarjeta.count(), "el alta sembró la tarjeta de la sucursal publicada").toBe(1);

      // El riesgo: la carta pública NO queda vacía con el portal nuevo.
      await page.goto(`/carta-publica/${EMPRESA}`);
      await expect(page.getByRole("link", { name: new RegExp(`Colores ${marca}`) })).toBeVisible();

      await page.goto("/carta/portal");
      await page.getByRole("group", { name: "Solapas" }).getByRole("button", { name: "Colores", exact: true }).click();
      await expect(page.locator('[data-fondo-portal="encabezado"]').getByLabel("Azul")).toBeChecked();
      await expect(page.locator('[data-fondo-portal="pagina"]').getByRole("radio", { name: "Otro color" })).toBeChecked();
      await page.getByRole("group", { name: "Solapas" }).getByRole("button", { name: "Portal", exact: true }).click();
      await expect(page.getByLabel("Título", { exact: true })).toHaveValue("Nuestros hoteles");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      await limpiar(sucursalId);
    }
  });
}
