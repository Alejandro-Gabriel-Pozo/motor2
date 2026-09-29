import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Carta pública nueva (ADR-006, Fase 3): `/carta-publica/<empresa>/...`, sin sesión. `CARTA_EMPRESA_SLUG=e2e`
 * (playwright.config.ts) es la única empresa que resuelve hoy (src/core/carta/empresa-carta.ts).
 */
const EMPRESA = "e2e";

test.describe("portal de sucursales", () => {
  test("lista una sucursal publicada y activa; oculta una no publicada y una inactiva", async ({ page, sucursalId }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const otra = await prisma.sucursal.create({ data: { nombre: `E2E Portal Otra ${marca}` } });
    const inactiva = await prisma.sucursal.create({ data: { nombre: `E2E Portal Inactiva ${marca}`, activo: false } });
    try {
      await prisma.sucursalPublica.createMany({
        data: [
          { sucursalId, slug: `e2e-central-${marca}`, publicada: true, etiqueta: `Central ${marca}` },
          { sucursalId: otra.id, slug: `e2e-otra-${marca}`, publicada: false, etiqueta: `Otra ${marca}` },
          { sucursalId: inactiva.id, slug: `e2e-inactiva-${marca}`, publicada: true, etiqueta: `Inactiva ${marca}` },
        ],
      });
      await page.goto(`/carta-publica/${EMPRESA}`);
      await expect(page.getByRole("link", { name: new RegExp(`Central ${marca}`) })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(`Otra ${marca}`) })).toHaveCount(0);
      await expect(page.getByRole("link", { name: new RegExp(`Inactiva ${marca}`) })).toHaveCount(0);
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId: { in: [sucursalId, otra.id, inactiva.id] } } });
      await prisma.sucursal.deleteMany({ where: { id: { in: [otra.id, inactiva.id] } } });
    }
  });

  test("una empresa que no resuelve da 404", async ({ page }) => {
    const r = await page.goto("/carta-publica/no-existe-esta-empresa");
    expect(r?.status()).toBe(404);
  });
});

test.describe("carta de una sucursal", () => {
  test("muestra la sección, un PV con precio formateado y la promo; slug inexistente da 404", async ({ page, sucursalId }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-carta-${marca}`;
    const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "unidad" } });
    const producto = await prisma.producto.create({
      data: { codigo: `E2E_CARTAPUB_${marca}`, nombre: `E2E Plato ${marca}`, tipo: "PV", precioVenta: 12345, unidadStockId: unidad.id },
    });
    const seccion = await prisma.seccionCarta.create({ data: { nombre: `E2E Sección ${marca}` } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
    await prisma.contenidoCartaProducto.create({ data: { productoId: producto.id, visibleEnCarta: true, seccionCartaId: seccion.id } });
    const promo = await prisma.promoCarta.create({ data: { sucursalId, seccionCartaId: seccion.id, titulo: `E2E Promo ${marca}`, precio: 5000 } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });

    try {
      const noExiste = await page.goto(`/carta-publica/${EMPRESA}/no-existe-${marca}`);
      expect(noExiste?.status()).toBe(404);

      await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
      // Ir a la sección desde el índice.
      await page.getByRole("button", { name: new RegExp(seccion.nombre) }).click();
      await expect(page.getByText(producto.nombre)).toBeVisible();
      await expect(page.getByText("$12.345")).toBeVisible();
      await expect(page.getByText(promo.titulo)).toBeVisible();
      await expect(page.getByText("$5.000")).toBeVisible();
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
      await prisma.promoCarta.delete({ where: { id: promo.id } });
      await prisma.contenidoCartaProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.seccionCarta.delete({ where: { id: seccion.id } });
      await prisma.producto.delete({ where: { id: producto.id } });
    }
  });

  test("con tema aplicado se ve el color de marca; sin aplicar, el default", async ({ page, sucursalId }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-tema-${marca}`;
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
    await prisma.temaCartaSucursal.create({ data: { sucursalId, aplicarEnCarta: true, valores: { color_marca: "#123456" } } });

    try {
      await page.goto(`/carta-publica/${EMPRESA}/${slug}`);
      // La variable se pisa en el wrapper de NavegacionCarta (dentro de .carta-shell): getComputedStyle sobre un
      // ANCESTRO no la vería (las custom properties heredan hacia abajo, no hacia arriba).
      const primary = await page.evaluate(() => getComputedStyle(document.querySelector(".carta-slider")!).getPropertyValue("--carta-color-marca").trim());
      expect(primary).toBe("#123456");
    } finally {
      await prisma.temaCartaSucursal.deleteMany({ where: { sucursalId } });
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    }
  });
});
