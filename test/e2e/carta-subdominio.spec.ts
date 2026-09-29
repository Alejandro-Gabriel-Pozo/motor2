import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Carta pública por subdominio (ADR-006, Fase 6): `carta.<empresa>.<CARTA_DOMINIO_BASE>` reescribe `/` al portal y `/<sucursal>` a la carta
 * (`reglasRewriteCarta`, next.config.ts). playwright.config.ts fija `CARTA_DOMINIO_BASE=localhost` y `CARTA_EMPRESA_SLUG=e2e`; Chromium resuelve
 * `*.localhost` a loopback, sin DNS ni hosts. El puerto es el del servidor de la suite.
 */
function origen(baseURL: string | undefined, empresa: string): string {
  const { port } = new URL(baseURL ?? "http://localhost");
  return `http://carta.${empresa}.localhost${port ? `:${port}` : ""}`;
}

test.describe("carta por subdominio", () => {
  test("/ es el portal de la empresa y /<sucursal> la carta, sin /carta-publica en la URL", async ({ page, sucursalId, baseURL }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-sub-${marca}`;
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true, etiqueta: `Sub ${marca}` } });
    const host = origen(baseURL, "e2e");
    try {
      await page.goto(`${host}/`);
      await expect(page).toHaveURL(`${host}/`);
      await expect(page.getByRole("link", { name: new RegExp(`Sub ${marca}`) })).toBeVisible();

      const r = await page.goto(`${host}/${slug}`);
      expect(r?.status()).toBe(200);
      await expect(page).toHaveURL(`${host}/${slug}`);
      await expect(page.locator(".carta-slider")).toBeVisible();

      const noExiste = await page.goto(`${host}/no-existe-${marca}`);
      expect(noExiste?.status()).toBe(404);
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    }
  });

  test("los links internos (portal → carta, ← Menú) y los paths /carta-publica/... quedan en la URL limpia del subdominio", async ({ page, sucursalId, baseURL }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-sub-${marca}`;
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true, etiqueta: `Sub ${marca}` } });
    const host = origen(baseURL, "e2e");
    try {
      await page.goto(`${host}/`);
      await page.getByRole("link", { name: new RegExp(`Sub ${marca}`) }).click();
      await expect(page).toHaveURL(`${host}/${slug}`);
      await expect(page.locator(".carta-slider")).toBeVisible();

      await page.getByRole("link", { name: "← Menú" }).click();
      await expect(page).toHaveURL(`${host}/`);
      await expect(page.getByRole("link", { name: new RegExp(`Sub ${marca}`) })).toBeVisible();

      // Un path viejo escrito a mano también termina en la URL limpia.
      await page.goto(`${host}/carta-publica/e2e/${slug}`);
      await expect(page).toHaveURL(`${host}/${slug}`);
      await page.goto(`${host}/carta-publica/e2e`);
      await expect(page).toHaveURL(`${host}/`);

      // En el host común de la app el path /carta-publica/... sigue siendo el de siempre (no redirige).
      await page.goto(`/carta-publica/e2e/${slug}`);
      await expect(page).toHaveURL(`/carta-publica/e2e/${slug}`);
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    }
  });

  test("una empresa que no resuelve da 404, y el host sin subdominio no reescribe /<sucursal>", async ({ page, sucursalId, baseURL }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-sub-${marca}`;
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
    try {
      // Con la empresa de la instalación el slug resuelve; con otra, no (el 404 es por la empresa, no por falta de rewrite).
      expect((await page.goto(`${origen(baseURL, "e2e")}/${slug}`))?.status()).toBe(200);
      const otraEmpresa = await page.goto(`${origen(baseURL, "otra")}/${slug}`);
      expect(otraEmpresa?.status()).toBe(404);

      // El mismo slug en el host común de la app: no hay ruta /<slug>, así que 404 (la regla depende del host).
      const hostComun = await page.goto(`/${slug}`);
      expect(hostComun?.status()).toBe(404);
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    }
  });
});
