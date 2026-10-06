import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Add-on CARTA_EMPRESA_UNICA (core/carta/carta-empresa-unica.ts, ADR-006): el dominio base pelado sirve la carta de UNA empresa sin su slug en la URL.
 * playwright.config.ts fija `CARTA_DOMINIO_BASE=carta.localhost` y `CARTA_EMPRESA_UNICA=e2e` (el slug de la empresa de la base, fixtures/auth.ts). Chromium resuelve
 * `carta.localhost` a loopback; los pedidos sin navegador van a loopback con otro header Host.
 */
function dominioBase(baseURL: string | undefined): string {
  const { port } = new URL(baseURL ?? "http://localhost");
  return `http://carta.localhost${port ? `:${port}` : ""}`;
}

test.describe("carta de la empresa única en el dominio base", () => {
  test("/ es el portal y /<sucursal> la carta, sin el slug de la empresa en la URL; ← Menú vuelve a /", async ({ page, sucursalId, baseURL }) => {
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-unica-${marca}`;
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true, etiqueta: `Unica ${marca}` } });
    const host = dominioBase(baseURL);
    try {
      const portal = await page.goto(`${host}/`);
      expect(portal?.status()).toBe(200);
      await expect(page).toHaveURL(`${host}/`);
      await expect(page.getByRole("link", { name: new RegExp(`Unica ${marca}`) })).toBeVisible();

      await page.getByRole("link", { name: new RegExp(`Unica ${marca}`) }).click();
      await expect(page).toHaveURL(`${host}/${slug}`);
      await expect(page.locator(".carta-slider")).toBeVisible();

      await page.getByRole("link", { name: "← Menú" }).click();
      await expect(page).toHaveURL(`${host}/`);

      const directa = await page.goto(`${host}/${slug}`);
      expect(directa?.status()).toBe(200);
      await expect(page).toHaveURL(`${host}/${slug}`);

      const noExiste = await page.goto(`${host}/no-existe-${marca}`);
      expect(noExiste?.status()).toBe(404);
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    }
  });

  test("en el dominio base todo lo que no es la carta da 404: login, auth, cron, la aplicación, escrituras y Server Actions", async ({ request, baseURL }) => {
    const { port } = new URL(baseURL ?? "http://localhost");
    const hostBase = `carta.localhost${port ? `:${port}` : ""}`;
    const pedir = (path: string, opciones: { method?: string; headers?: Record<string, string> } = {}) =>
      request.fetch(`${baseURL}${path}`, { method: opciones.method ?? "GET", headers: { host: hostBase, ...opciones.headers }, maxRedirects: 0 });

    for (const path of ["/login", "/api/auth/session", "/api/auth/signin", "/api/cron/sincronizar-dolar", "/api/cron/sincronizar-ipc", "/mesas/x", "/carta/tema", "/carta/portal", "/dashboard"]) {
      const r = await pedir(path);
      expect(r.status(), path).toBe(404);
      expect(await r.text(), path).not.toMatch(/csrfToken|providers|Iniciar sesión|<form/i);
    }
    expect((await pedir("/", { method: "POST" })).status()).toBe(404);
    expect((await pedir("/central", { method: "POST" })).status()).toBe(404);
    expect((await pedir("/", { headers: { "next-action": "abc123" } })).status()).toBe(404);
  });

  test("los paths /carta-publica/<empresa>/... redirigen a la URL limpia: en el dominio base y desde el host de la app", async ({ request, baseURL }) => {
    const { port } = new URL(baseURL ?? "http://localhost");
    const sufijo = port ? `:${port}` : "";
    const pedir = (host: string, path: string) => request.get(`${baseURL}${path}`, { headers: { host: `${host}${sufijo}` }, maxRedirects: 0 });

    const enBase = await pedir("carta.localhost", "/carta-publica/e2e/central");
    expect(enBase.status()).toBe(307);
    expect(enBase.headers()["location"]).toBe("/central");
    const portalEnBase = await pedir("carta.localhost", "/carta-publica/e2e");
    expect(portalEnBase.status()).toBe(307);
    expect(portalEnBase.headers()["location"]).toBe("/");

    const desdeApp = await pedir("app-e2e.localhost", "/carta-publica/e2e/central");
    expect(desdeApp.status()).toBe(307);
    expect(desdeApp.headers()["location"]).toBe("https://carta.localhost/central");
    const portalDesdeApp = await pedir("app-e2e.localhost", "/carta-publica/e2e");
    expect(portalDesdeApp.status()).toBe(307);
    expect(portalDesdeApp.headers()["location"]).toBe("https://carta.localhost/");

    // `localhost` pelado (desarrollo) sigue sirviendo por path, sin redirigir.
    expect((await request.get(`${baseURL}/carta-publica/e2e/central`, { maxRedirects: 0 })).status()).not.toBe(307);
  });

  test("la carta del dominio base sale con CSP estricta y noindex, igual que por subdominio", async ({ request, baseURL, sucursalId }) => {
    const { port } = new URL(baseURL ?? "http://localhost");
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-uhdr-${marca}`;
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
    try {
      const porPath = await request.get(`${baseURL}/carta-publica/e2e/${slug}`);
      const cspCarta = porPath.headers()["content-security-policy"];
      const enBase = await request.get(`${baseURL}/${slug}`, { headers: { host: `carta.localhost${port ? `:${port}` : ""}` } });
      expect(enBase.status()).toBe(200);
      expect(enBase.headers()["content-security-policy"]).toBe(cspCarta);
      expect(enBase.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(enBase.headers()["content-security-policy"]).not.toContain("nonce-");
      expect(enBase.headers()["x-robots-tag"]).toContain("noindex");
      expect(enBase.headers()["x-frame-options"]).toBe("DENY");
    } finally {
      await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    }
  });
});
