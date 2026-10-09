import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * La CSP con nonce (informe de seguridad S-04, `core/seguridad/cabeceras.ts`) no puede romper la aplicación: ninguna pantalla pierde un
 * script, un estilo, una fuente o una imagen por la política, y la hidratación sigue funcionando (un clic de cliente navega sin recargar).
 * El navegador avisa cada bloqueo con el evento `securitypolicyviolation`.
 */
const PANTALLAS = ["/inicio", "/catalogo/proveedores", "/catalogo/proveedores/nuevo", "/reportes/costos", "/carta/portal", "/stock/alertas"];

// S-24: el portal público de una empresa que no publicó ninguna sucursal da 404 (como un slug inexistente), así que el spec publica una a propósito.
test.beforeEach(async ({ sucursalId }) => {
  await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
  await prisma.sucursalPublica.create({ data: { sucursalId, slug: `e2e-csp-${Date.now()}`, publicada: true } });
});
test.afterEach(async ({ sucursalId }) => {
  await prisma.sucursalPublica.deleteMany({ where: { sucursalId } });
});

test("las pantallas de la aplicación y la carta no tienen ninguna violación de CSP, y la hidratación funciona", async ({ paginaAutenticada: page }) => {
  const violaciones: string[] = [];
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) violaciones.push(m.text());
  });
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });

  for (const ruta of [...PANTALLAS, "/carta-publica/e2e"]) {
    const r = await page.goto(ruta);
    expect(r?.status(), ruta).toBeLessThan(400);
    await page.waitForLoadState("networkidle");
    const propias = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect(propias, `${ruta}: bloqueos`).toEqual([]);
  }

  // Hidratación: un enlace del cliente navega sin recargar el documento.
  await page.goto("/catalogo/proveedores");
  await page.evaluate(() => ((window as unknown as { __marca: number }).__marca = 1));
  await page.getByRole("link", { name: /Nuevo proveedor|Nuevo/ }).first().click();
  await page.waitForURL(/\/catalogo\/proveedores\/nuevo/);
  expect(await page.evaluate(() => (window as unknown as { __marca?: number }).__marca), "navegación del cliente (sin recarga)").toBe(1);
  expect(violaciones).toEqual([]);
});
