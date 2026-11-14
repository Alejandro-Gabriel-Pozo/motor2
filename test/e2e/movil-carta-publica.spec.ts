import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { capturar, expectObjetivosTactiles, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * MOVIL — carta pública en celular (375 × 812), pase de pantalla del 2026-11-13 (defectos 2 y 7 del ensayo general):
 *  - el texto de un plato (nombre y precio) nunca queda por debajo de 4,5:1 contra el fondo de la carta, aunque el color de marca del tema de la sucursal sea más tenue (caso real:
 *    marca #797d62 sobre fondo #181818 = 4,16:1);
 *  - los controles de la carta («← PORTAL», «Imprimir carta», los botones del índice) miden 44 px o más;
 *  - sin desborde horizontal y axe en 0 (incluida la regla de contraste).
 * Mide, no mira: el contraste se calcula con los colores que el navegador realmente pinta.
 */
const MARCA_DE_LA_PRUEBA = "#797d62";
const FONDO_DE_LA_PRUEBA = "#181818";

/** Contraste WCAG entre el color de texto y el fondo de un renglón, tal como los pinta el navegador (un canvas normaliza cualquier formato de color a RGB). */
async function contrasteDe(page: Page, texto: Locator, fondo: Locator): Promise<number> {
  const colores = {
    texto: await texto.evaluate((n) => getComputedStyle(n).color),
    fondo: await fondo.evaluate((n) => getComputedStyle(n).backgroundColor),
  };
  return page.evaluate((c) => {
    const lienzo = document.createElement("canvas");
    lienzo.width = lienzo.height = 1;
    const ctx = lienzo.getContext("2d", { willReadFrequently: true })!;
    const rgb = (color: string) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
    };
    const luz = ([r, g, b]: number[]) => {
      const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4));
      return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
    };
    const [a, b] = [luz(rgb(c.texto)), luz(rgb(c.fondo))];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, colores);
}

async function sembrar(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `e2e-mcp-${marca}`;
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Móvil carta ${marca}`, orden: 1 } });
  const crear = (q: string, precioVenta: number) => prisma.producto.create({ data: { codigo: `E2E-MCP-${q}-${marca}`, nombre: `E2E ${q} ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta } });
  const [especial, comun] = await Promise.all([crear("Chivo al disco", 18500), crear("Milanesa", 9000)]);
  const productoIds = [especial.id, comun.id];
  await prisma.disponibilidadProducto.createMany({ data: productoIds.map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: especial.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 1, especial: true } });
  await prisma.contenidoCartaProducto.create({ data: { sucursalId, productoId: comun.id, visibleEnCarta: true, seccionCartaId: seccion.id, orden: 2 } });
  await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
  await prisma.temaCartaSucursal.create({ data: { sucursalId, aplicarEnCarta: true, valores: { color_fondo_dia: FONDO_DE_LA_PRUEBA, color_marca: MARCA_DE_LA_PRUEBA, topbar_back_label: "← PORTAL", restaurante_instagram: "@e2e", restaurante_whatsapp: "5492991234567" } } });
  return {
    ruta: `/carta-publica/e2e/${slug}`,
    nombreEspecial: especial.nombre,
    nombreComun: comun.nombre,
    limpiar: async () => {
      await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.seccionCarta.deleteMany({ where: { id: seccion.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: productoIds } } });
      await prisma.producto.deleteMany({ where: { id: { in: productoIds } } });
    },
  };
}

test("carta pública en celular (375 px): el texto de los platos llega a 4,5:1 con una marca tenue, los controles miden 44 px, sin desborde y axe en 0", async ({ page, sucursalId }) => {
  const d = await sembrar(sucursalId);
  try {
    await fijarCelular(page);
    await page.goto(d.ruta);
    const libro = page.locator("[data-carta-libro]");
    await expect(libro).toBeVisible();
    await expectSinDesborde(page, "carta pública, portada");
    await expectObjetivosTactiles(page.locator("[data-carta-topbar] button, [data-carta-topbar] a"), "carta pública: barra superior");

    // Íconos de redes de la barra inferior (portada): 44 × 44 (antes 40 × 40).
    const redes = page.locator("[data-carta-nav] a");
    await expect(redes).toHaveCount(2);
    await expectObjetivosTactiles(redes, "carta pública: íconos de redes de la portada", { ancho: 44 });

    // El índice: cada botón de sección mide 44 px o más.
    await page.getByRole("button", { name: "Página siguiente" }).click();
    const botonesDelIndice = page.locator("[data-carta-indice-lista] button");
    await expect(botonesDelIndice.first()).toBeVisible();
    await expectObjetivosTactiles(botonesDelIndice, "carta pública: índice");
    await capturar(page, "carta-publica-indice");

    // La sección con los platos: contraste del nombre y del precio contra el fondo de la carta.
    await botonesDelIndice.first().click();
    const renglonEspecial = page.locator("h3", { hasText: d.nombreEspecial }).locator("xpath=ancestor::*[.//*[@data-rol='precio']][1]");
    await expect(renglonEspecial).toBeVisible();
    for (const [nombre, texto] of [
      ["nombre del plato especial", renglonEspecial.locator("h3")],
      ["precio del plato especial", renglonEspecial.locator("[data-rol='precio']")],
    ] as const) {
      expect.soft(await contrasteDe(page, texto, libro), `contraste del ${nombre} sobre ${FONDO_DE_LA_PRUEBA}`).toBeGreaterThanOrEqual(4.5);
    }
    const renglonComun = page.locator("h3", { hasText: d.nombreComun }).locator("xpath=ancestor::*[.//*[@data-rol='precio']][1]");
    expect.soft(await contrasteDe(page, renglonComun.locator("[data-rol='precio']"), libro), "contraste del precio del plato común").toBeGreaterThanOrEqual(4.5);
    await capturar(page, "carta-publica-seccion");
    // En las páginas de sección los íconos de redes van en su propia fila bajo las flechas: también 44 × 44 (antes 32 × 32), y la barra sigue dentro de la pantalla.
    await expectObjetivosTactiles(page.locator("[data-carta-nav] a"), "carta pública: íconos de redes de una sección", { ancho: 44 });
    const barra = (await page.locator("[data-carta-nav]").boundingBox())!;
    expect.soft(barra.y + barra.height, "la barra de navegación termina dentro de la pantalla").toBeLessThanOrEqual(812 + 1);

    await expectSinDesborde(page, "carta pública, sección");
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations, "axe en la carta pública a 375 px").toEqual([]);
  } finally {
    await d.limpiar();
  }
});
