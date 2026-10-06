import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Carta pública por subdominio (ADR-006, Fase 6): `<empresa>.<CARTA_DOMINIO_BASE>` reescribe `/` al portal y `/<sucursal>` a la carta
 * (`reglasRewriteCarta`, next.config.ts). playwright.config.ts fija `CARTA_DOMINIO_BASE=carta.localhost` y la empresa de la base tiene slug `e2e` (fixtures/auth.ts); Chromium resuelve
 * `*.localhost` (también `e2e.carta.localhost`) a loopback, sin DNS ni hosts. El puerto es el del servidor de la suite.
 */
function origen(baseURL: string | undefined, empresa: string): string {
  const { port } = new URL(baseURL ?? "http://localhost");
  return `http://${empresa}.carta.localhost${port ? `:${port}` : ""}`;
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

  test("en el host de la app (no el de la carta) /carta-publica/... redirige al host de la carta en vez de servir la carta", async ({ request, baseURL }) => {
    const { port } = new URL(baseURL ?? "http://localhost");
    const hostApp = `app-e2e.localhost${port ? `:${port}` : ""}`;
    // El pedido va a loopback con otro header Host (Node no resuelve *.localhost; el matching de Next es por header).
    const pedir = (path: string) => request.get(`${baseURL}${path}`, { headers: { host: hostApp }, maxRedirects: 0 });

    // Con el add-on activo (CARTA_EMPRESA_UNICA=e2e) la empresa `e2e` va al dominio base pelado (carta-empresa-unica.spec.ts); acá se prueba el camino por subdominio con otra empresa.
    const portal = await pedir("/carta-publica/otra");
    expect(portal.status()).toBe(307);
    expect(portal.headers()["location"]).toBe("https://otra.carta.localhost/");

    const carta = await pedir("/carta-publica/otra/central");
    expect(carta.status()).toBe(307);
    expect(carta.headers()["location"]).toBe("https://otra.carta.localhost/central");

    // `localhost` pelado (desarrollo) sigue sirviendo por path, sin redirigir.
    const local = await request.get(`${baseURL}/carta-publica/e2e/central`, { maxRedirects: 0 });
    expect(local.status()).not.toBe(307);
  });

  test("en el host de la carta todo lo que no es la carta da 404: login, auth, cron, la aplicación y el dominio base pelado (informe de seguridad S-04/S-05)", async ({ request, baseURL }) => {
    const { port } = new URL(baseURL ?? "http://localhost");
    const sufijo = port ? `:${port}` : "";
    const pedir = (host: string, path: string) => request.get(`${baseURL}${path}`, { headers: { host: `${host}${sufijo}` }, maxRedirects: 0 });

    for (const path of ["/login", "/api/auth/session", "/api/auth/signin", "/api/cron/sincronizar-dolar", "/api/cron/sincronizar-ipc", "/mesas/x", "/carta/tema", "/carta/portal", "/dashboard"]) {
      const r = await pedir("e2e.carta.localhost", path);
      expect(r.status(), path).toBe(404);
      expect(await r.text(), path).not.toMatch(/csrfToken|providers|Iniciar sesión|<form/i);
    }
    // Los subdominios de dos niveles no son una carta. El dominio base pelado solo lo es con el add-on de la empresa única (carta-empresa-unica.spec.ts), y aun así /login es 404.
    for (const host of ["carta.localhost", "a.b.carta.localhost"]) {
      expect((await pedir(host, "/login")).status(), host).toBe(404);
    }
    expect((await pedir("a.b.carta.localhost", "/")).status()).toBe(404);
    // El host de la app sigue sirviendo su login.
    expect((await request.get(`${baseURL}/login`, { maxRedirects: 0 })).status()).toBe(200);
  });

  test("las cartas salen con CSP estricta y noindex; la app con CSP con nonce y sin 'unsafe-inline' en scripts (S-04)", async ({ request, baseURL, sucursalId }) => {
    const { port } = new URL(baseURL ?? "http://localhost");
    const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const slug = `e2e-hdr-${marca}`;
    await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
    await prisma.sucursalPublica.create({ data: { sucursalId, slug, publicada: true } });
    try {
      const carta = await request.get(`${baseURL}/carta-publica/e2e/${slug}`);
      expect(carta.status()).toBe(200);
      const cspCarta = carta.headers()["content-security-policy"];
      expect(cspCarta).toContain("frame-ancestors 'none'");
      expect(cspCarta).not.toContain("nonce-");
      expect(carta.headers()["x-robots-tag"]).toContain("noindex");
      expect(carta.headers()["x-frame-options"]).toBe("DENY");
      expect(carta.headers()["x-content-type-options"]).toBe("nosniff");

      const cartaSub = await request.get(`${baseURL}/${slug}`, { headers: { host: `e2e.carta.localhost${port ? `:${port}` : ""}` } });
      expect(cartaSub.status()).toBe(200);
      expect(cartaSub.headers()["content-security-policy"]).toBe(cspCarta);

      const login = await request.get(`${baseURL}/login`);
      const cspApp = login.headers()["content-security-policy"];
      expect(cspApp).toMatch(/script-src[^;]*'nonce-[^']+'/);
      expect(cspApp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
      expect(cspApp).toContain("frame-ancestors 'none'");
      expect(login.headers()["x-frame-options"]).toBe("DENY");
      expect(login.headers()["referrer-policy"]).toBeTruthy();
      expect(login.headers()["permissions-policy"]).toBeTruthy();
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
