import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * «Volver a donde estaba»: cuando la sesión vence con la pestaña abierta, el login recuerda la pantalla (`/login?volver=…`) y, al
 * entrar, se vuelve a ella. El paso de Google no se puede probar acá (no hay credenciales de Google en las pruebas): se comprueba
 * que se recuerde la pantalla, que el login con sesión válida respete `volver`, y que `volver` NUNCA lleve a otro sitio.
 */
test("enviar un formulario con la sesión vencida lleva a /login recordando la pantalla", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/proveedores/nuevo");
  await expect(page.getByText("Nuevo proveedor")).toBeVisible();
  await page.locator('input[name="nombre"]').fill(`E2E Proveedor Volver ${Date.now()}`);

  await prisma.session.deleteMany({ where: { user: { email: "e2e-admin@local.test" } } });
  await page.getByRole("button", { name: "Crear proveedor", exact: true }).click();

  await page.waitForURL(/\/login\?volver=/);
  expect(new URL(page.url()).searchParams.get("volver")).toBe("/catalogo/proveedores/nuevo");
});

test("el login con la sesión válida respeta `volver` (una ruta interna)", async ({ paginaAutenticada: page }) => {
  await page.goto("/login?volver=%2Freportes%2Fcostos");
  await page.waitForURL(/\/reportes\/costos$/);
  await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();
});

test("`volver` nunca lleva a otro sitio ni a un lugar inválido (ni da error con letras fuera de ASCII): se ignora y se entra por la pantalla de inicio", async ({ paginaAutenticada: page, baseURL }) => {
  for (const malicioso of ["//sitio-falso.example.com/reportes", "https://sitio-falso.example.com", "/\\sitio-falso.example.com", "javascript:alert(1)", "/login", "/api/auth/signout", "/р", "/x😀"]) {
    await page.goto(`/login?volver=${encodeURIComponent(malicioso)}`);
    await page.waitForURL(/\/inicio$/); // el admin de pruebas entra por el panel de inicio
    expect(new URL(page.url()).host).toBe(new URL(baseURL ?? "http://localhost:3000").host); // sigue en este sitio
    expect(page.url()).not.toContain("sitio-falso");
  }
});

test("sin sesión, el login muestra el botón de Google también cuando trae `volver`", async ({ browser, baseURL }) => {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();
  await pagina.goto(`${baseURL}/login?volver=%2Fcatalogo%2Fproveedores`);
  await expect(pagina.getByRole("button", { name: "Ingresar con Google" })).toBeVisible();
  await contexto.close();
});

/**
 * Carga directa (F5, un favorito, la URL tipeada) sin sesión: el navegador no manda `Referer`, así que la pantalla la recuerda
 * `src/proxy.ts` (solo corre en los pedidos sin cookie de sesión). Se prueba con un navegador sin ninguna cookie.
 */
test("una carga directa sin sesión va a /login recordando la pantalla y su consulta", async ({ browser, baseURL }) => {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();

  await pagina.goto(`${baseURL}/reportes/costos?desde=2026-09-01`);
  await pagina.waitForURL(/\/login\?volver=/);
  expect(new URL(pagina.url()).searchParams.get("volver")).toBe("/reportes/costos?desde=2026-09-01");
  await expect(pagina.getByRole("button", { name: "Ingresar con Google" })).toBeVisible();

  // Otra pantalla, con una ruta dinámica: se recuerda la que se pidió, no la anterior.
  await pagina.goto(`${baseURL}/catalogo/recetas/abc123`);
  await pagina.waitForURL(/\/login\?volver=/);
  expect(new URL(pagina.url()).searchParams.get("volver")).toBe("/catalogo/recetas/abc123");

  // El login mismo no se recuerda (sería un bucle): entrar directo a /login queda en /login.
  await pagina.goto(`${baseURL}/login`);
  expect(new URL(pagina.url()).search).toBe("");
  await contexto.close();
});

test("`_rsc` (el parámetro interno de las navegaciones del cliente) no se cuela en la ruta recordada", async ({ browser, baseURL }) => {
  const contexto = await browser.newContext();
  const pagina = await contexto.newPage();

  await pagina.goto(`${baseURL}/reportes/costos?_rsc=abc12&desde=2026-09-01`);
  await pagina.waitForURL(/\/login\?volver=/);
  expect(new URL(pagina.url()).searchParams.get("volver")).toBe("/reportes/costos?desde=2026-09-01");
  await contexto.close();
});
