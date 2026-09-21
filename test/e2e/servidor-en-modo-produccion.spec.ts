import { test, expect } from "@playwright/test";

/**
 * El servidor de la suite corre en el modo que playwright.config.ts DICE (MOTOR2_E2E_SERVIDOR: build | start | dev). Sin este spec, nada impide que la
 * suite corra contra `next dev` creyendo que corre contra el artefacto de producción: el gate de cierre mentiría en silencio.
 *
 * La señal es la cabecera de caché de los estáticos (node_modules/next/dist/server/lib/router-server.js): `next dev` los sirve con
 * `no-cache, must-revalidate` y `next start` con `public, max-age=31536000, immutable`. En producción, además, no existe el indicador de desarrollo
 * (`<nextjs-portal>`). No usa la sesión: /login es pública.
 */
const modo = process.env.MOTOR2_E2E_SERVIDOR;

test(`el servidor E2E corre en modo «${modo}» de verdad`, async ({ page }) => {
  expect(["build", "start", "dev"], "playwright.config.ts no fijó MOTOR2_E2E_SERVIDOR").toContain(modo);

  await page.goto("/login");
  const src = await page.locator('script[src*="/_next/static/"]').first().getAttribute("src");
  expect(src, "la página no carga ningún script de /_next/static/").toBeTruthy();
  const cache = (await page.request.get(src!)).headers()["cache-control"] ?? "";

  if (modo === "dev") {
    expect(cache, "en dev los estáticos no se cachean").toContain("must-revalidate");
    expect(cache).not.toContain("immutable");
  } else {
    expect(cache, "en producción los estáticos son inmutables: si no lo son, el servidor NO está en modo producción").toContain("immutable");
    await expect(page.locator("nextjs-portal"), "el indicador de desarrollo no existe en producción").toHaveCount(0);
  }
});
