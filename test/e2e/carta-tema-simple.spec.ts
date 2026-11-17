import AxeBuilder from "@axe-core/playwright";
import type { Locator } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { temaSimpleVisible } from "../../src/lib/tema-simple-visible";

/** Espera a que React haya hidratado el elemento (mismo criterio que carta-tema-admin.spec.ts). */
async function esperarHidratado(el: Locator) {
  await expect
    .poll(() => el.evaluate((nodo) => Object.keys(nodo).some((k) => k.startsWith("__reactProps"))), { message: "elemento hidratado", timeout: 30_000 })
    .toBe(true);
}

/**
 * Pantalla SIMPLE del tema (PASO A de «Apariencia y publicación», `docs/diseno-carta-apariencia-y-publicacion-como-pedernal-2026-11-17.md`), de punta a punta, en los DOS estados del interruptor `TEMA_SIMPLE_VISIBLE` (como
 * `carta-descuento-producto.spec.ts`): apagado (el de hoy) se comprueba que la pantalla es la de siempre; encendido (en el e2e, con `MOTOR2_PRUEBAS_TEMA_SIMPLE=si` en el entorno de la corrida, que lo ven el servidor y el spec) se recorre la
 * pantalla simple a 375 y 1366 px con axe. Este spec encendido es la CONDICIÓN para poner `TEMA_SIMPLE_VISIBLE = true`. Los specs `carta-tema-admin` y `carta-marca-admin` son de la pantalla de siempre: con el interruptor encendido se omiten.
 */
test("apagado: la pestaña Tema es la de siempre (el editor completo, sin pantalla simple)", async ({ paginaAutenticada: page }) => {
  test.skip(temaSimpleVisible(), "la pantalla simple está encendida: vale el recorrido de abajo");
  await page.goto("/carta/tema");
  await expect(page.getByRole("heading", { name: "Tema de la carta", level: 1 })).toBeVisible();
  await expect(page.locator("[data-tema-simple]")).toHaveCount(0);
  await expect(page.locator("[data-seccion-marca]")).toBeVisible();
});

for (const ancho of [375, 1366]) {
  test(`encendido (${ancho} px): elegir un color, ver la vista previa con texto legible, guardar, recargar y ver lo guardado, con axe 0`, async ({ paginaAutenticada: page, sucursalId }) => {
    test.skip(!temaSimpleVisible(), "la pantalla simple está apagada (TEMA_SIMPLE_VISIBLE = false en src/core/carta/tema-simple.ts): la pestaña Tema es la de siempre");
    await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
    // Una clave que la pantalla simple no pide y que ya estaba cargada: tiene que sobrevivir al guardado («lo cargado manda»).
    await prisma.temaCartaSucursal.create({ data: { sucursalId, valores: { hero_ink: "claro", carta_texto_portada_cta: "Ver la carta" }, aplicarEnCarta: true } });
    await page.setViewportSize({ width: ancho, height: ancho === 375 ? 812 : 768 });
    try {
      await page.goto("/carta/tema");
      await expect(page.getByRole("heading", { name: "Identidad de la carta", level: 1 })).toBeVisible();
      const pantalla = page.locator("[data-tema-simple]");
      await expect(pantalla).toBeVisible();
      // Solo los diez campos (el color de marca por paleta, más 9 de texto): rubro, lugar y foto de portada incluidos; ni tipografía, ni lema, ni descripción.
      await expect(pantalla.locator("input[name]:not([type=radio])")).toHaveCount(9);
      await expect(page.getByText("Tipografía")).toHaveCount(0);
      await expect(page.getByText("Descripción")).toHaveCount(0);

      const azul = pantalla.getByLabel("Azul");
      await esperarHidratado(azul);
      await azul.check();
      // Sin ajuste ni aviso de contraste: el texto de la carta va en colores fijos del sistema y la marca solo en acentos.
      await expect(page.locator("[data-aviso-marca-ajustada]")).toHaveCount(0);
      await expect(page.getByText(/Se usa #/)).toHaveCount(0);
      await expect(page.locator("[data-vista-previa-tema-simple]")).toBeVisible();

      await pantalla.getByLabel("Nombre").fill("Hotel de prueba");
      await pantalla.getByLabel("Instagram").fill("hoteldeprueba");
      await pantalla.getByLabel("Rubro").fill("Hotel y spa");
      await pantalla.getByLabel("Lugar").fill("Huinganco, Neuquén");
      await pantalla.getByLabel("Foto de portada").fill("https://cdn.example.com/portada.jpg");
      // «Otro color» mal escrito: el campo lo marca.
      await pantalla.getByLabel("Otro color").check();
      await pantalla.getByLabel("Color principal (por ejemplo #0e7490)").fill("azul");
      await expect(page.getByText("Escribí el color como #0e7490")).toBeVisible();
      await pantalla.getByLabel("Azul").check();

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sin desborde horizontal").toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      // Nada se guardó hasta el clic: lo que había sigue igual.
      expect((await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId } })).valores).toEqual({ hero_ink: "claro", carta_texto_portada_cta: "Ver la carta" });

      const guardar = page.getByRole("button", { name: "Guardar", exact: true });
      expect((await guardar.boundingBox())?.height ?? 0, "objetivo táctil de 44 px").toBeGreaterThanOrEqual(ancho === 375 ? 44 : 32);
      await guardar.click();
      await expect(page.getByRole("status").filter({ hasText: "guardado" })).toBeVisible();

      const fila = await prisma.temaCartaSucursal.findFirstOrThrow({ where: { sucursalId } });
      expect(fila.valores).toEqual({ hero_ink: "claro", carta_texto_portada_cta: "Ver la carta", color_marca: "#1f4e79", marca_derivada: "oscura", restaurante_nombre: "Hotel de prueba", restaurante_instagram: "hoteldeprueba", hero_etiqueta_superior: "Hotel y spa", restaurante_subtitulo: "Huinganco, Neuquén", hero_imagen_fondo_url: "https://cdn.example.com/portada.jpg" });
      expect(fila.aplicarEnCarta).toBe(true);

      await page.reload();
      await expect(page.getByLabel("Azul")).toBeChecked();
      await expect(page.getByLabel("Nombre")).toHaveValue("Hotel de prueba");
      await expect(page.getByLabel("Rubro")).toHaveValue("Hotel y spa");
      await expect(page.getByLabel("Lugar")).toHaveValue("Huinganco, Neuquén");
      await expect(page.getByLabel("Foto de portada")).toHaveValue("https://cdn.example.com/portada.jpg");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
    }
  });
}
