import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { abrirComoRol } from "./fixtures/rol-pos";
import { capturar, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * Fase 7, módulo Stock (DEC-27; `docs/diseno-modulo-stock-2026-10-27.md`): las dos entradas del menú con sus pestañas, el atajo «Cambiar mínimo» de Alertas (que no pisa el cambio de otra persona),
 * «Parámetros por insumo» y ver ≠ escribir (DEC-33), con axe y sin desborde a 375 px. Con `MOTOR2_CAPTURAS_MOVIL` deja las capturas a 375 y 1280 px para la aprobación del dueño.
 */
const ESCRITORIO = { width: 1280, height: 900 } as const;

async function sembrar(sucursalId: string, seccionId: string) {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const leche = await prisma.producto.create({ data: { codigo: `E2E-STK-L-${marca}`, nombre: `E2E Leche entera larga vida ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: leche.id, disponible: true } });
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: compra.id, productoId: leche.id, seccionId, proceso: "COMPRA", cantidad: 2, detalle: "Stock inicial del test", precioTotal: 0, precioPorUnidadStock: 0 },
  });
  // Mínimo global 10 con saldo 2: alerta «Bajo». Y una agenda de conteo, para que «Parámetros por insumo» tenga dos columnas con datos.
  const minimo = await prisma.stockMinimoProducto.create({ data: { sucursalId, productoId: leche.id, minimo: 10 } });
  await prisma.frecuenciaConteoProducto.create({ data: { sucursalId, productoId: leche.id, frecuenciaDias: 7 } });
  return {
    leche,
    minimo,
    limpiar: async () => {
      await prisma.registroAuditoria.deleteMany({ where: { entidad: "StockMinimoProducto", entidadId: minimo.id } }).catch(() => undefined);
      await prisma.frecuenciaConteoProducto.deleteMany({ where: { productoId: leche.id } });
      await prisma.stockMinimoProducto.deleteMany({ where: { productoId: leche.id } });
      await prisma.movimientoStock.deleteMany({ where: { productoId: leche.id } });
      await prisma.operacion.deleteMany({ where: { id: compra.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: leche.id } });
      await prisma.producto.deleteMany({ where: { id: leche.id } });
    },
  };
}

const sinViolaciones = async (page: Page, donde: string) => expect((await new AxeBuilder({ page }).analyze()).violations, `${donde}: axe`).toEqual([]);
const menuActivo = (page: Page) => page.locator('aside nav a[aria-current="page"]');

test("Existencias: pestañas, alerta y «Cambiar mínimo» que guarda con el valor visto (y avisa si otra persona lo cambió)", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  test.setTimeout(240_000);
  const s = await sembrar(sucursalId, seccionId);
  try {
    await page.setViewportSize(ESCRITORIO);
    await page.goto("/stock/consolidado");
    await expect(page.getByRole("heading", { name: "Existencias · Consolidado", exact: true })).toBeVisible();
    const pestanas = page.getByRole("navigation", { name: "Qué existencias ver" });
    await expect(pestanas.getByRole("link")).toHaveText(["Consolidado", "Por familia", "Alertas"]);
    await expect(menuActivo(page)).toHaveText("Existencias");
    await capturar(page, "1280-existencias-consolidado");

    await pestanas.getByRole("link", { name: "Alertas" }).click();
    await expect(page.getByRole("heading", { name: "Existencias · Alertas", exact: true })).toBeVisible();
    await expect(menuActivo(page)).toHaveText("Existencias");
    const fila = page.locator("tr", { hasText: s.leche.nombre });
    await expect(fila).toContainText("Bajo");
    await sinViolaciones(page, "alertas");
    await capturar(page, "1280-existencias-alertas");

    // «Cambiar mínimo»: abre el editor sobre la fila global, con el insumo y el depósito fijos.
    await fila.getByRole("link", { name: `Cambiar mínimo de ${s.leche.nombre} en` }).click();
    await expect(page).toHaveURL(new RegExp(`/stock/minimo\\?editar=${s.minimo.id}$`));
    await expect(page.getByRole("heading", { name: "Cambiar el stock mínimo" })).toBeVisible();
    await expect(page.getByText("Global (toda la sucursal)").last()).toBeVisible();
    await expect(menuActivo(page)).toHaveText("Configuración");
    await sinViolaciones(page, "editor del mínimo");
    await capturar(page, "1280-configuracion-cambiar-minimo");

    // Otra persona lo cambia mientras tanto: no se pisa, se avisa con el valor de hoy.
    await prisma.stockMinimoProducto.update({ where: { id: s.minimo.id }, data: { minimo: 7 } });
    const campo = page.getByLabel("Mínimo", { exact: true });
    await campo.fill("12");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByText(/cambió mientras lo editabas: ahora es 7\. No se guardó nada/)).toBeVisible();
    expect(Number((await prisma.stockMinimoProducto.findUniqueOrThrow({ where: { id: s.minimo.id } })).minimo)).toBe(7);

    // Con el valor de hoy (la página se refrescó), guarda.
    await page.reload();
    await page.getByLabel("Mínimo", { exact: true }).fill("12");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page).toHaveURL(/\/stock\/minimo$/);
    await expect(page.locator("tr", { hasText: s.leche.nombre })).toContainText("12");
    expect(Number((await prisma.stockMinimoProducto.findUniqueOrThrow({ where: { id: s.minimo.id } })).minimo)).toBe(12);
  } finally {
    await s.limpiar();
  }
});

test("Configuración: «Parámetros por insumo» y sus pestañas (Depósitos, Motivos, Destinos) resaltan la entrada", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  test.setTimeout(240_000);
  const s = await sembrar(sucursalId, seccionId);
  try {
    await page.setViewportSize(ESCRITORIO);
    await page.goto("/stock/configuracion");
    await expect(page.getByRole("heading", { name: "Configuración · Parámetros por insumo", exact: true })).toBeVisible();
    const pestanas = page.getByRole("navigation", { name: "Qué configurar" });
    await expect(pestanas.getByRole("link")).toHaveText(["Parámetros por insumo", "Depósitos", "Motivos de merma", "Destinos de consumo"]);
    const fila = page.locator("tr", { hasText: s.leche.nombre });
    await expect(fila).toContainText("10");
    await expect(fila).toContainText("Cada 7 día(s)");
    await expect(fila.getByRole("link", { name: `Cambiar el stock mínimo de ${s.leche.nombre}` })).toBeVisible();
    await sinViolaciones(page, "parámetros por insumo");
    await capturar(page, "1280-configuracion-parametros");

    for (const [pestana, titulo] of [
      ["Depósitos", "Configuración · Depósitos"],
      ["Motivos de merma", "Configuración · Motivos de merma"],
      ["Destinos de consumo", "Configuración · Destinos de consumo"],
    ] as const) {
      await page.getByRole("navigation", { name: "Qué configurar" }).getByRole("link", { name: pestana }).click();
      await expect(page.getByRole("heading", { name: titulo, exact: true })).toBeVisible();
      await expect(menuActivo(page)).toHaveText("Configuración");
    }
    await capturar(page, "1280-configuracion-destinos");
  } finally {
    await s.limpiar();
  }
});

test("celular (375 px): las pantallas del módulo no se salen por la derecha y pasan axe", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  test.setTimeout(240_000);
  const s = await sembrar(sucursalId, seccionId);
  try {
    await fijarCelular(page);
    for (const [ruta, nombre] of [
      ["/stock/consolidado", "existencias-consolidado"],
      ["/stock/por-familia", "existencias-por-familia"],
      ["/stock/alertas", "existencias-alertas"],
      ["/stock/configuracion", "configuracion-parametros"],
      [`/stock/minimo?editar=${s.minimo.id}`, "configuracion-cambiar-minimo"],
      ["/movimientos/secciones", "configuracion-depositos"],
      [`/movimientos/conteo-fisico?seccionId=${seccionId}`, "movimientos-conteo-fisico"],
      ["/movimientos/merma", "movimientos-merma"],
    ] as const) {
      await page.goto(ruta);
      await expect(page.locator("h1").first(), `${ruta}: la pantalla cargó`).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expectSinDesborde(page, ruta);
      await sinViolaciones(page, `${ruta} a 375 px`);
      await capturar(page, `375-${nombre}`);
    }
  } finally {
    await s.limpiar();
  }
});

test("ver ≠ escribir: con «Ver» de la frecuencia de conteo y del stock (sin «Editar»), el formulario está deshabilitado con aviso y no hay «Cambiar»", async ({ browser, baseURL, sucursalId, seccionId }) => {
  test.setTimeout(240_000);
  const s = await sembrar(sucursalId, seccionId);
  const rol = await abrirComoRol(browser, baseURL, sucursalId, { ver_stock: "ver", conteo_frecuencia: "ver" });
  try {
    const { page } = rol;
    await page.setViewportSize(ESCRITORIO);
    await page.goto("/stock/conteo-frecuencia");
    await expect(page.getByRole("heading", { name: "Configuración · Frecuencia de conteo", exact: true })).toBeVisible();
    await expect(page.getByText("Solo lectura: tu rol puede ver la frecuencia de conteo, pero no hacer cambios.")).toBeVisible();
    await expect(page.locator("form fieldset")).toHaveAttribute("disabled", "");
    await expect(page.getByRole("combobox", { name: "Producto" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Guardar" })).toBeDisabled();
    await expect(page.locator("tr", { hasText: s.leche.nombre }).getByRole("link", { name: "Editar" })).toHaveCount(0);
    await sinViolaciones(page, "frecuencia solo lectura");
    await capturar(page, "1280-configuracion-frecuencia-solo-lectura");

    // Parámetros por insumo: solo la columna que ve (frecuencia), sin «Cambiar»; las pestañas que no puede abrir no se dibujan.
    await page.goto("/stock/configuracion");
    await expect(page.getByRole("navigation", { name: "Qué configurar" }).getByRole("link")).toHaveText(["Parámetros por insumo"]);
    await expect(page.getByRole("columnheader", { name: "Frecuencia de conteo" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Stock mínimo" })).toHaveCount(0);
    await expect(page.locator("tr", { hasText: s.leche.nombre }).getByRole("link", { name: /Cambiar/ })).toHaveCount(0);

    // Alertas: ve la alerta, no el atajo, y lee por qué.
    await page.goto("/stock/alertas");
    await expect(page.locator("tr", { hasText: s.leche.nombre })).toContainText("Bajo");
    await expect(page.getByRole("link", { name: /Cambiar mínimo/ })).toHaveCount(0);
    await expect(page.getByText("Cambiar un mínimo pide el permiso de edición de «Stock mínimo»: tu rol solo puede ver las alertas.")).toBeVisible();
  } finally {
    await rol.limpiar();
    await s.limpiar();
  }
});
