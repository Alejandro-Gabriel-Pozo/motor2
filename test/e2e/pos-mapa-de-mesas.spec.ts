import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { abrirComoRol } from "./fixtures/rol-pos";

/**
 * Mapa de mesas del salón (módulo POS, docs/plan-mapa-de-mesas-2026-09-24.md). Los estados `en_pedido`/`ocupada` se prueban acá con
 * filas sembradas (el circuito real de tomar pedido está en pos-tomar-pedido.spec.ts). Cada caso limpia lo suyo en `finally` (el
 * número de mesa es único por sucursal y otros casos cuentan las mesas).
 */

type ConMarca = { __sinRecargar?: boolean };
const ponerMarca = (page: Page) => page.evaluate(() => ((window as unknown as ConMarca).__sinRecargar = true));
const marcaSigue = (page: Page) => page.evaluate(() => (window as unknown as ConMarca).__sinRecargar === true);

const tarjeta = (page: Page, numero: number) => page.locator(`li[data-mesa="${numero}"]`);

/** Tres mesas en «Central»: libre, en pedido (1 ítem sin enviar) y ocupada (ítems enviados en los envíos 1 y 2). */
async function sembrarTresMesas(sucursalId: string, numeros: [number, number, number]) {
  const marca = Date.now();
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-POS-${marca}`, nombre: `E2E Plato Salón ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 18400 } });
  const [libre, enPedido, ocupada] = await Promise.all(numeros.map((numero) => prisma.mesa.create({ data: { sucursalId, numero } })));

  const hace = (min: number) => new Date(Date.now() - min * 60_000);
  await prisma.cuenta.create({
    data: { mesaId: enPedido.id, abiertaPorId: admin.id, abiertaEn: hace(5), items: { create: [{ productoId: producto.id, cantidad: 1, precioUnitario: 18400 }] } },
  });
  await prisma.cuenta.create({
    data: {
      mesaId: ocupada.id,
      abiertaPorId: admin.id,
      abiertaEn: hace(42),
      items: {
        create: [
          { productoId: producto.id, cantidad: 2, precioUnitario: 15000, numeroEnvio: 1 },
          { productoId: producto.id, cantidad: 1, precioUnitario: 11900, numeroEnvio: 2 },
        ],
      },
    },
  });

  return {
    libre,
    enPedido,
    ocupada,
    limpiar: async () => {
      const mesaIds = [libre.id, enPedido.id, ocupada.id];
      await prisma.cuentaItem.deleteMany({ where: { cuenta: { mesaId: { in: mesaIds } } } });
      await prisma.cuenta.deleteMany({ where: { mesaId: { in: mesaIds } } });
      await prisma.mesa.deleteMany({ where: { id: { in: mesaIds } } });
      await prisma.producto.deleteMany({ where: { id: producto.id } });
    },
  };
}

test("el mapa muestra las mesas con sus datos reales: métricas, tarjetas de los tres estados, filtro por estado y búsqueda", async ({ paginaAutenticada: page, sucursalId }) => {
  const { limpiar } = await sembrarTresMesas(sucursalId, [901, 902, 903]);
  try {
    await page.goto("/mesas");
    await expect(page).toHaveTitle("Salón · Motor2");
    await expect(page.getByRole("heading", { level: 1, name: "Mapa de mesas" })).toBeVisible();

    const resumen = page.getByRole("region", { name: "Resumen de mesas" });
    for (const [label, valor] of [["Total de mesas", "3"], ["Libres", "1"], ["En pedido", "1"], ["Ocupadas", "1"]]) {
      await expect(resumen.locator(`[data-metrica="${label}"]`), label).toContainText(valor);
    }

    await expect(tarjeta(page, 901)).toContainText("MESA");
    await expect(tarjeta(page, 901)).toContainText("901");
    await expect(tarjeta(page, 901)).toContainText("Libre");
    await expect(tarjeta(page, 901)).toContainText("Disponible para comensales");

    await expect(tarjeta(page, 902)).toContainText("En pedido");
    await expect(tarjeta(page, 902)).toContainText("1 producto sin enviar");
    await expect(tarjeta(page, 902)).toContainText(/\$\s?18\.400/);

    // Mozo sin nombre → la parte local del email. Total: 2 × 15.000 + 11.900 = 41.900. Envíos 1 y 2 → dos pedidos enviados.
    await expect(tarjeta(page, 903)).toContainText(/e2e-admin · hace 4\d min/);
    await expect(tarjeta(page, 903)).toContainText("2 pedidos enviados");
    await expect(tarjeta(page, 903)).toContainText(/\$\s?41\.900/);

    // Filtro por estado: por la URL, con el conteo en cada pestaña.
    const filtros = page.getByRole("navigation", { name: "Filtrar por estado" });
    await filtros.getByRole("link", { name: "Ocupadas · 1" }).click();
    await page.waitForURL(/\/mesas\?estado=ocupada$/);
    await expect(page.locator("li[data-mesa]")).toHaveCount(1);
    await expect(tarjeta(page, 903)).toBeVisible();
    await expect(filtros.getByRole("link", { name: "Ocupadas · 1" })).toHaveAttribute("aria-current", "true");

    // Búsqueda por número (conserva el filtro de estado elegido: sin coincidencias → estado vacío explicado).
    await page.getByLabel("Buscar mesa").fill("902");
    await page.getByLabel("Buscar mesa").press("Enter");
    await page.waitForURL(/estado=ocupada&q=902/);
    await expect(page.getByText("Ninguna mesa coincide con el filtro.")).toBeVisible();

    await page.goto("/mesas?q=902");
    await expect(page.locator("li[data-mesa]")).toHaveCount(1);
    await expect(tarjeta(page, 902)).toBeVisible();
  } finally {
    await limpiar();
  }
});

test("las acciones de cada tarjeta llevan a la pantalla de la mesa; «Opciones de mesa» sigue deshabilitado, y el salón no muestra el menú de administración", async ({ paginaAutenticada: page, sucursalId }) => {
  const { libre, enPedido, ocupada, limpiar } = await sembrarTresMesas(sucursalId, [911, 912, 913]);
  try {
    await page.goto("/mesas");
    await expect(tarjeta(page, 911).getByRole("link", { name: "Tomar pedido" })).toHaveAttribute("href", `/mesas/${libre.id}`);
    await expect(tarjeta(page, 912).getByRole("link", { name: "Continuar pedido" })).toHaveAttribute("href", `/mesas/${enPedido.id}`);
    await expect(tarjeta(page, 913).getByRole("link", { name: "Ver pedidos" })).toHaveAttribute("href", `/mesas/${ocupada.id}`);
    await expect(tarjeta(page, 913).getByRole("link", { name: "Facturar" })).toHaveAttribute("href", `/mesas/${ocupada.id}`);
    await expect(tarjeta(page, 913).getByRole("button", { name: "Opciones de mesa" })).toBeDisabled();
    // Ya no queda ningún botón de acción deshabilitado por corte de alcance, ni la nota del pie que lo explicaba.
    await expect(page.getByRole("button", { name: /Tomar pedido|Continuar pedido|Ver pedidos|Facturar/ })).toHaveCount(0);
    await expect(page.getByText("todavía no están habilitados en esta versión")).toHaveCount(0);

    // Sin el menú lateral de la administración (ni su botón de ocultar, ni sus enlaces); sí el enlace de vuelta para el admin.
    await expect(page.getByRole("button", { name: /menú/ })).toHaveCount(0);
    await expect(page.locator('a[href="/administracion/usuarios"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Administración" })).toHaveAttribute("href", "/reportes");
  } finally {
    await limpiar();
  }
});

test("«Nueva mesa» crea la mesa sin recargar la página, con el número siguiente sugerido, y un número repetido muestra el error", async ({ paginaAutenticada: page, sucursalId }) => {
  await prisma.mesa.create({ data: { sucursalId, numero: 950 } });
  try {
    await page.goto("/mesas");
    await expect(tarjeta(page, 950)).toBeVisible();
    await ponerMarca(page);

    await page.getByRole("button", { name: "Nueva mesa" }).click();
    const dialogo = page.getByRole("dialog", { name: "Nueva mesa" });
    await expect(dialogo.getByLabel("Número de mesa")).toHaveValue("951");
    await dialogo.getByRole("button", { name: "Crear mesa" }).click();
    await expect(dialogo).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Mesa 951 creada." })).toBeVisible();
    await expect(tarjeta(page, 951)).toBeVisible();
    await expect(tarjeta(page, 951)).toContainText("Libre");

    // Repetido: el diálogo queda abierto con el mensaje de negocio, y no se crea nada.
    await page.getByRole("button", { name: "Nueva mesa" }).click();
    await expect(dialogo.getByLabel("Número de mesa")).toHaveValue("952");
    await dialogo.getByLabel("Número de mesa").fill("950");
    await dialogo.getByRole("button", { name: "Crear mesa" }).click();
    await expect(dialogo.getByRole("alert")).toHaveText("Ya existe la mesa 950 en esta sucursal.");
    await dialogo.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialogo).toHaveCount(0);
    expect(await prisma.mesa.count({ where: { sucursalId, numero: { in: [950, 951, 952] } } })).toBe(2);

    expect(await marcaSigue(page), "la página se recargó: la mesa nueva no se vio por el refresco del cliente").toBe(true);
  } finally {
    await prisma.mesa.deleteMany({ where: { sucursalId, numero: { in: [950, 951, 952] } } });
  }
});

test("permisos: con Ver sin Editar se ve el mapa con «Nueva mesa» deshabilitado; sin pos_mesas, el aviso de permiso y nada del mapa", async ({ browser, baseURL, sucursalId }) => {
  const soloVe = await abrirComoRol(browser, baseURL, sucursalId, { pos_mesas: "ver" });
  const sinPermiso = await abrirComoRol(browser, baseURL, sucursalId, {});
  try {
    await soloVe.page.goto("/mesas");
    await expect(soloVe.page.getByRole("heading", { level: 1, name: "Mapa de mesas" })).toBeVisible();
    await expect(soloVe.page.getByRole("button", { name: "Nueva mesa" })).toBeDisabled();

    await sinPermiso.page.goto("/mesas");
    await expect(sinPermiso.page.getByText(/No tenés permiso para ver esta sección/)).toBeVisible();
    await expect(sinPermiso.page.getByRole("heading", { name: "Mapa de mesas" })).toHaveCount(0);
    await expect(sinPermiso.page.getByRole("button", { name: "Nueva mesa" })).toHaveCount(0);
  } finally {
    await soloVe.limpiar();
    await sinPermiso.limpiar();
  }
});

test("un rol con solo pos_mesas (el «mozo», creado desde la matriz) entra directo al mapa y no ve el enlace a la administración", async ({ browser, baseURL, sucursalId }) => {
  const mozo = await abrirComoRol(browser, baseURL, sucursalId, { pos_mesas: "editar" });
  try {
    await mozo.page.goto("/");
    await mozo.page.waitForURL(/\/mesas$/);
    await expect(mozo.page.getByRole("heading", { level: 1, name: "Mapa de mesas" })).toBeVisible();
    await expect(mozo.page.getByRole("button", { name: "Nueva mesa" })).toBeEnabled();
    await expect(mozo.page.getByRole("link", { name: "Administración" })).toHaveCount(0);
  } finally {
    await mozo.limpiar();
  }
});

test("sin sesión, /mesas lleva al login recordando la pantalla", async ({ browser, baseURL }) => {
  const contexto = await browser.newContext();
  try {
    const page = await contexto.newPage();
    await page.goto(`${baseURL}/mesas`);
    await page.waitForURL(/\/login\?volver=%2Fmesas$/);
    await expect(page.getByRole("button", { name: "Ingresar con Google" })).toBeVisible();
  } finally {
    await contexto.close();
  }
});

test("con el sistema en modo oscuro, el salón sigue claro (tokens en .pos-shell, no en :root)", async ({ paginaAutenticada: page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/mesas");
  await expect(page.getByRole("heading", { level: 1, name: "Mapa de mesas" })).toBeVisible();
  const estilos = await page.evaluate(() => {
    const shell = document.querySelector(".pos-shell");
    const h1 = document.querySelector("main h1");
    if (!shell || !h1) return null;
    const s = getComputedStyle(shell);
    return { fondo: s.backgroundColor, texto: s.color, esquema: s.colorScheme, titulo: getComputedStyle(h1).color, raiz: getComputedStyle(document.documentElement).colorScheme };
  });
  expect(estilos).toEqual({ fondo: "rgb(250, 250, 248)", texto: "rgb(28, 27, 25)", esquema: "light", titulo: "rgb(28, 27, 25)", raiz: "light dark" });
});
