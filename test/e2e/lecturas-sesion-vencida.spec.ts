import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { anterior, completarPasoFactura, elegirProductoEnLaFila, llenarLinea, siguiente, verPaso } from "./fixtures/compra-por-pasos";

/**
 * Las lecturas de servidor exigen sesión (src/server/actions/con-sesion.ts). Si la sesión venció, o un admin desactivó
 * al usuario con la pestaña abierta, o se cortó la conexión, la lectura se rechaza. Antes de useLeerServidor, el buscador
 * de productos se quedaba en «Buscando…» para siempre (la línea que apagaba el estado de carga nunca corría) y otros
 * componentes dejaban un rechazo sin manejar. Ahora avisan, y con la sesión vencida la página lleva sola al login.
 */
const EMAIL_ADMIN_E2E = "e2e-admin@local.test";
const rutaCompra = /\/movimientos\/compra(\?.*)?$/;
async function elegirSelectPorOpcion(page: Page, textoOpcion: string) {
  for (const select of await page.locator("select").all()) {
    if ((await select.locator("option").allTextContents()).includes(textoOpcion)) {
      await select.selectOption({ label: textoOpcion });
      return;
    }
  }
  throw new Error(`Ningún <select> tiene una opción "${textoOpcion}"`);
}
const buscador = 'input[placeholder="Código o nombre…"]';

/** El buscador de productos de Compra vive en el paso 2 «Qué compraste»: se llega con un proveedor y un número de factura. */
async function irAlPasoDeLasLineas(page: Page) {
  const ahora = Date.now();
  const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_LSV_${ahora}`, nombre: `E2E Proveedor Lecturas ${ahora}` } });
  await page.goto("/movimientos/compra");
  await completarPasoFactura(page, { proveedor: proveedor.nombre });
}

test("el buscador de productos avisa si falla la lectura, en vez de quedarse en «Buscando…»", async ({ paginaAutenticada: page }) => {
  await irAlPasoDeLasLineas(page);
  await page.route(rutaCompra, async (route) => {
    if (route.request().method() === "POST") await route.abort();
    else await route.continue();
  });

  await page.locator(buscador).first().fill("a");

  await expect(page.getByText(/No se pudo buscar/)).toBeVisible();
  await expect(page.getByText("Buscando…")).toHaveCount(0);
});

test("con la sesión vencida, el buscador de productos lleva al login", async ({ paginaAutenticada: page }) => {
  await irAlPasoDeLasLineas(page);
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
  const fila = page.locator("tr", { has: page.locator(`input[value="${insumo.nombre}"]`) });
  await fila.getByRole("button", { name: "Renombrar/fusionar" }).click();

  await expect(page.getByText(/No se pudo comprobar si ya existe un insumo con ese nombre/).first()).toBeVisible();
  // El insumo no cambió de nombre: nada se escribió.
  expect((await prisma.insumo.findUniqueOrThrow({ where: { id: insumo.id } })).nombre).toBe(insumo.nombre);
});

test("sin conexión de ningún tipo (ni siquiera el refresco de la página), el aviso aparece y el formulario a medio llenar no se pierde", async ({ paginaAutenticada: page, sucursalId }) => {
  const ahora = Date.now();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-LSV-OFF-${ahora}`, nombre: `E2E Producto Sin Conexion ${ahora}`, tipo: "MP", unidadStockId: unidad.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  const seccion = await prisma.seccion.findFirstOrThrow({ where: { sucursalId, activa: true } });
  await irAlPasoDeLasLineas(page);
  // El «Detalle» está en el paso 3: se lo llena con conexión y se vuelve al paso 2 a buscar sin ella.
  await elegirProductoEnLaFila(page, producto.nombre);
  await llenarLinea(page, { cantidad: "1", importe: "10", referencia: "Producto sin conexión" });
  await siguiente(page);
  await verPaso(page, 3, "Dónde entra");
  await page.getByRole("combobox", { name: "Depósito", exact: true }).selectOption({ label: seccion.nombre });
  const detalle = page.getByLabel("Detalle (opcional)");
  await detalle.fill("Detalle escrito antes de que se corte la conexión");
  await anterior(page);
  await verPaso(page, 2, "Qué compraste");
  await page.getByRole("button", { name: /\+ Agregar insumo/ }).click();
  await expect(page.locator(buscador)).toHaveCount(2);

  // Se corta TODO el tráfico: el pedido de la búsqueda (en la línea nueva, vacía) falla y el `router.refresh()` que pide el hook también.
  await page.context().setOffline(true);
  await page.locator(buscador).nth(1).fill("a");

  await expect(page.getByText(/No se pudo buscar/)).toBeVisible();
  await page.waitForTimeout(1500); // margen para que un refresco fallido llegue a romper la página, si fuera a hacerlo
  await expect(page.getByText(/No se pudo buscar/)).toBeVisible();
  // No apareció la pantalla de error por defecto de Next.
  await expect(page.getByText(/Application error|Unhandled Runtime Error|This page couldn.t load/i)).toHaveCount(0);
  await expect(page).toHaveURL(/\/movimientos\/compra/);
  // Pasar de paso no necesita al servidor: lo escrito en el paso 3 sigue ahí.
  await siguiente(page);
  await verPaso(page, 3, "Dónde entra");
  await expect(detalle).toHaveValue("Detalle escrito antes de que se corte la conexión");
});

test("con la sesión vencida, elegir un proveedor en Compra lleva al login (antes solo avisaba y había que adivinar que era la sesión)", async ({ paginaAutenticada: page }) => {
  const ahora = Date.now();
  const proveedor = await prisma.proveedor.create({ data: { codigo: `PRV_E2E_SV_${ahora}`, nombre: `E2E Proveedor Sesion ${ahora}` } });
  await page.goto("/movimientos/compra");
  await verPaso(page, 1, "Factura");

  await prisma.session.deleteMany({ where: { user: { email: EMAIL_ADMIN_E2E } } });
  await elegirSelectPorOpcion(page, proveedor.nombre);

  await page.waitForURL(/\/login/);
});

test("con la sesión vencida, el disponible de Reclasificar lleva al login; con la sesión vigente lo muestra", async ({ paginaAutenticada: page, seccionId }) => {
  const ahora = Date.now();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({
    data: { codigo: `E2E-RC-${ahora}`, nombre: `E2E Producto Reclasif ${ahora}`, tipo: "MP", unidadStockId: unidad.id, unidadCompraId: unidad.id },
  });
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });
  // El selector filtra { soloDisponibles: true } (reclasificar-form.tsx) — sin esto no aparece ninguna opción.
  await prisma.disponibilidadProducto.create({ data: { sucursalId: seccion.sucursalId, productoId: producto.id, disponible: true } });
  await page.goto("/stock/reclasificar");

  // Vigente: elegir producto y sección origen muestra «Disponible en origen» (sin stock, es 0).
  await page.locator(buscador).first().fill(producto.codigo);
  await page.getByRole("option", { name: new RegExp(producto.codigo) }).click();
  await elegirSelectPorOpcion(page, seccion.nombre);
  await expect(page.getByText(/Disponible en origen/)).toBeVisible();
  await expect(page.getByText(/No se pudo consultar el disponible/)).toHaveCount(0);

  // Vencida: cambiar el lote origen repite la consulta, que se rechaza y el refresco lleva al login.
  await prisma.session.deleteMany({ where: { user: { email: EMAIL_ADMIN_E2E } } });
  await page.locator('input[type="date"]').nth(1).fill("2030-01-01");
  await page.waitForURL(/\/login/);
});
