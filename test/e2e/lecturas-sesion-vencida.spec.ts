import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Las lecturas de servidor exigen sesión (src/server/actions/con-sesion.ts). Si la sesión venció, o un admin desactivó
 * al usuario con la pestaña abierta, o se cortó la conexión, la lectura se rechaza. Antes de useLeerServidor, el buscador
 * de productos se quedaba en «Buscando…» para siempre (la línea que apagaba el estado de carga nunca corría) y otros
 * componentes dejaban un rechazo sin manejar. Ahora avisan, y con la sesión vencida la página lleva sola al login.
 */
const EMAIL_ADMIN_E2E = "e2e-admin@local.test";
const rutaCompra = /\/movimientos\/compra(\?.*)?$/;
const buscador = 'input[placeholder="Código o nombre…"]';

test("el buscador de productos avisa si falla la lectura, en vez de quedarse en «Buscando…»", async ({ paginaAutenticada: page }) => {
  await page.goto("/movimientos/compra");
  await page.route(rutaCompra, async (route) => {
    if (route.request().method() === "POST") await route.abort();
    else await route.continue();
  });

  await page.locator(buscador).first().fill("a");

  await expect(page.getByText(/No se pudo buscar/)).toBeVisible();
  await expect(page.getByText("Buscando…")).toHaveCount(0);
});

test("con la sesión vencida, el buscador de productos lleva al login", async ({ paginaAutenticada: page }) => {
  await page.goto("/movimientos/compra");
  await expect(page.locator(buscador).first()).toBeVisible();

  // La sesión vence con la pestaña abierta: se borran las sesiones del usuario de prueba.
  await prisma.session.deleteMany({ where: { user: { email: EMAIL_ADMIN_E2E } } });

  await page.locator(buscador).first().fill("a");

  // La lectura se rechaza, el componente pide un refresco y el layout, sin sesión, redirige.
  await page.waitForURL(/\/login/);
});

test("renombrar un insumo avisa si falla la comprobación previa, sin romper la página", async ({ paginaAutenticada: page }) => {
  const ahora = Date.now();
  const insumo = await prisma.insumo.create({ data: { nombre: `E2E Insumo Lectura ${ahora}` } });
  await page.goto("/catalogo/insumos-grupos");

  await page.route(/\/catalogo\/insumos-grupos(\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") await route.abort();
    else await route.continue();
  });

  // Sin editar el nombre: alcanza con tocar «Renombrar/fusionar», que empieza por la lectura de comprobación (que falla).
  const entrada = page.locator(`input[value="${insumo.nombre}"]`);
  await entrada.locator("xpath=following-sibling::button").click();

  await expect(page.getByText(/No se pudo comprobar si ya existe un insumo con ese nombre/).first()).toBeVisible();
  // El insumo no cambió de nombre: nada se escribió.
  expect((await prisma.insumo.findUniqueOrThrow({ where: { id: insumo.id } })).nombre).toBe(insumo.nombre);
});

test("sin conexión de ningún tipo (ni siquiera el refresco de la página), el aviso aparece y el formulario a medio llenar no se pierde", async ({ paginaAutenticada: page }) => {
  await page.goto("/movimientos/compra");
  await expect(page.locator(buscador).first()).toBeVisible();
  const detalle = page.getByLabel("Detalle (opcional)");
  await detalle.fill("Detalle escrito antes de que se corte la conexión");

  // Se corta TODO el tráfico: el pedido de la búsqueda falla y el `router.refresh()` que pide el hook también.
  await page.context().setOffline(true);
  await page.locator(buscador).first().fill("a");

  await expect(page.getByText(/No se pudo buscar/)).toBeVisible();
  await page.waitForTimeout(1500); // margen para que un refresco fallido llegue a romper la página, si fuera a hacerlo
  await expect(page.getByText(/No se pudo buscar/)).toBeVisible();
  await expect(detalle).toHaveValue("Detalle escrito antes de que se corte la conexión");
  // No apareció la pantalla de error por defecto de Next.
  await expect(page.getByText(/Application error|Unhandled Runtime Error|This page couldn.t load/i)).toHaveCount(0);
  await expect(page).toHaveURL(/\/movimientos\/compra/);
});
