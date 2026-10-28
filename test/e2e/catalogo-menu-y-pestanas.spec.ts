import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { ajustarCeldasDelAdmin } from "./fixtures/admin-con-filas";
import { capturar, expectSinDesborde, fijarCelular } from "./fixtures/movil";

/**
 * Fase 7, módulo Catálogo (DEC-13; `docs/diseno-modulo-catalogo-2026-10-28.md`): las cinco entradas del menú, las pestañas de «Productos» y de «Maestros», ver ≠ escribir (DEC-33), la búsqueda por cómo
 * lo llama el proveedor (M2) y «Cómo lo llama» destacado en la ficha del proveedor (M1), con axe y sin desborde a 375 px. Con `MOTOR2_CAPTURAS_MOVIL` deja las capturas a 375 y 1280 px para la aprobación
 * del dueño.
 */
const ESCRITORIO = { width: 1280, height: 900 } as const;
const menu = (page: Page) => page.locator("aside nav");
const menuActivo = (page: Page) => page.locator('aside nav a[aria-current="page"]');
const sinViolaciones = async (page: Page, donde: string) => expect((await new AxeBuilder({ page }).analyze()).violations, `${donde}: axe`).toEqual([]);

/** Un producto con dos proveedores que lo nombran distinto en su factura (el caso del dueño: un producto por insumo y la referencia de cada proveedor). */
async function sembrar(sucursalId: string, seccionId: string) {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-CAT-${marca}`, nombre: `E2E Ojo de bife ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  const proveedor = await prisma.proveedor.create({ data: { codigo: `E2E-PRV-${marca}`, nombre: `E2E Frigorífico ${marca}` } });
  const referencia = `Bife ancho rioplatense ${marca}`;
  await prisma.proveedorPorProducto.create({ data: { productoId: producto.id, proveedorId: proveedor.id, unidadCompraId: kg.id, referenciaProveedor: referencia } });
  // «Lo que se le compra» se deriva de las compras vigentes del Kardex: una compra de ese proveedor (la referencia vive en la tabla del vínculo, como la escribe la compra).
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id, proveedorId: proveedor.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: compra.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 3, detalle: "Compra del test", precioTotal: 30000, precioPorUnidadStock: 10000 },
  });
  return {
    producto,
    proveedor,
    referencia,
    limpiar: async () => {
      await prisma.movimientoStock.deleteMany({ where: { productoId: producto.id } });
      await prisma.operacion.deleteMany({ where: { id: compra.id } });
      await prisma.proveedorPorProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.proveedor.deleteMany({ where: { id: proveedor.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.producto.deleteMany({ where: { id: producto.id } });
    },
  };
}

test("el menú de Catálogo tiene cinco entradas; Productos y Maestros abren sus pestañas y resaltan su entrada", async ({ paginaAutenticada: page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(ESCRITORIO);
  // Una pantalla de Empresa (Clientes) deja el menú en ese panel, donde están las cinco entradas (Productos es de los dos).
  await page.goto("/catalogo/clientes");
  await expect(page.getByRole("heading", { name: "Clientes con descuento", exact: true })).toBeVisible();
  for (const entrada of ["Productos", "Biblioteca de opciones", "Maestros", "Proveedores", "Clientes con descuento"]) {
    await expect(menu(page).getByRole("link", { name: entrada, exact: true }), entrada).toHaveCount(1);
  }
  // Las pantallas que dejaron de ser ítems ya no están en el menú (se llega por las pestañas).
  for (const vieja of ["Precio local", "Recetas", "Opciones de venta", "Insumos / Grupos", "Categorías", "Unidades", "Margen objetivo"]) {
    await expect(menu(page).getByRole("link", { name: vieja, exact: true }), vieja).toHaveCount(0);
  }

  await menu(page).getByRole("link", { name: "Productos", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Productos", exact: true })).toBeVisible();
  const deProductos = page.getByRole("navigation", { name: "Qué mirar de los productos" });
  await expect(deProductos.getByRole("link")).toHaveText(["Productos", "Precio local", "Recetas"]);
  await expect(menuActivo(page)).toHaveText("Productos");
  await sinViolaciones(page, "productos");
  await capturar(page, "1280-productos");

  await deProductos.getByRole("link", { name: "Precio local" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Productos · Precio local en «");
  await expect(menuActivo(page)).toHaveText("Productos");
  await sinViolaciones(page, "precio local");
  await capturar(page, "1280-productos-precio-local");

  await page.getByRole("navigation", { name: "Qué mirar de los productos" }).getByRole("link", { name: "Recetas" }).click();
  await expect(page.getByRole("heading", { name: "Productos · Recetas", exact: true })).toBeVisible();
  await expect(menuActivo(page)).toHaveText("Productos");
  await sinViolaciones(page, "recetas");
  await capturar(page, "1280-productos-recetas");

  await menu(page).getByRole("link", { name: "Maestros", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Maestros · Insumos", exact: true })).toBeVisible();
  const deMaestros = page.getByRole("navigation", { name: "Qué maestro" });
  await expect(deMaestros.getByRole("link")).toHaveText(["Insumos", "Categorías", "Unidades", "Margen objetivo"]);
  await sinViolaciones(page, "maestros insumos");
  await capturar(page, "1280-maestros-insumos");
  for (const [pestana, titulo, captura] of [
    ["Categorías", "Maestros · Categorías", "1280-maestros-categorias"],
    ["Unidades", "Maestros · Unidades de medida", "1280-maestros-unidades"],
    ["Margen objetivo", "Maestros · Margen objetivo (food cost)", "1280-maestros-margen"],
  ] as const) {
    await page.getByRole("navigation", { name: "Qué maestro" }).getByRole("link", { name: pestana }).click();
    await expect(page.getByRole("heading", { name: titulo, exact: true })).toBeVisible();
    await expect(menuActivo(page)).toHaveText("Maestros");
    await sinViolaciones(page, titulo);
    await capturar(page, captura);
  }

  await menu(page).getByRole("link", { name: "Biblioteca de opciones", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Biblioteca de opciones", exact: true })).toBeVisible();
  await capturar(page, "1280-biblioteca-de-opciones");
  await page.goto("/catalogo/clientes");
  await capturar(page, "1280-clientes");
  await page.goto("/catalogo/proveedores");
  await capturar(page, "1280-proveedores");
});

test("M2 y M1: se encuentra el producto escribiendo lo que dice la factura, y la ficha del proveedor muestra «Cómo lo llama» primero", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  test.setTimeout(240_000);
  const s = await sembrar(sucursalId, seccionId);
  try {
    await page.setViewportSize(ESCRITORIO);
    await page.goto("/catalogo/productos");
    const busqueda = page.getByLabel("Buscar por nombre, código o cómo lo llama el proveedor");
    await busqueda.fill("ancho rioplatense");
    await busqueda.press("Enter");
    await page.waitForURL(/q=ancho/);
    await expect(page.locator("tr", { hasText: s.producto.nombre })).toBeVisible();
    await capturar(page, "1280-productos-busqueda-por-factura");

    await page.goto(`/catalogo/proveedores/${s.proveedor.id}`);
    const encabezados = page.getByRole("region", { name: "Lo que se le compra" }).getByRole("columnheader");
    await expect(encabezados.first()).toHaveText("Cómo lo llama (en su factura)");
    await expect(page.getByRole("cell", { name: s.referencia, exact: true })).toBeVisible();
    await sinViolaciones(page, "ficha del proveedor");
    await capturar(page, "1280-proveedor-ficha");
  } finally {
    await s.limpiar();
  }
});

test("ver ≠ escribir: con solo «Ver» de unidades, clientes y proveedores, las pantallas se leen sin formularios y con el aviso", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  test.setTimeout(240_000);
  const s = await sembrar(sucursalId, seccionId);
  // Piso administrador: el caso se arma sobre el rol «admin» del e2e (se restaura al final; los e2e corren de a uno).
  const admin = await ajustarCeldasDelAdmin({
    unidades: { puedeVer: true, puedeEditar: false },
    clientes: { puedeVer: true, puedeEditar: false },
    proveedores: { puedeVer: true, puedeEditar: false },
    proveedor_alta: { puedeVer: true, puedeEditar: false },
  });
  try {
    await page.setViewportSize(ESCRITORIO);
    await page.goto("/catalogo/unidades");
    await expect(page.getByText("Solo lectura: tu rol puede ver las unidades de medida, pero no hacer cambios.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nueva unidad" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Guardar|Desactivar|Activar|Crear/ })).toHaveCount(0);
    await sinViolaciones(page, "unidades solo lectura");
    await capturar(page, "1280-maestros-unidades-solo-lectura");

    await page.goto("/catalogo/clientes");
    await expect(page.getByText("Solo lectura: tu rol puede ver los clientes con descuento, pero no hacer cambios.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Crear|Desactivar|Activar/ })).toHaveCount(0);

    await page.goto("/catalogo/proveedores");
    await expect(page.getByText("Solo lectura: tu rol puede ver los proveedores, pero no hacer cambios.")).toBeVisible();
    await expect(page.locator("tr", { hasText: s.proveedor.nombre }).getByRole("link", { name: "Editar" })).toHaveCount(0);
    await page.goto(`/catalogo/proveedores/${s.proveedor.id}`);
    await expect(page.getByRole("link", { name: "Editar", exact: true })).toHaveCount(0);
  } finally {
    await admin.restaurar();
    await s.limpiar();
  }
});

test("celular (375 px): las pantallas del módulo no se salen por la derecha y pasan axe", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  test.setTimeout(300_000);
  const s = await sembrar(sucursalId, seccionId);
  try {
    await fijarCelular(page);
    for (const [ruta, nombre] of [
      ["/catalogo/productos", "productos"],
      ["/movimientos/precio-local", "productos-precio-local"],
      ["/catalogo/recetas", "productos-recetas"],
      ["/catalogo/opciones", "biblioteca-de-opciones"],
      ["/catalogo/insumos-grupos", "maestros-insumos"],
      ["/catalogo/categorias", "maestros-categorias"],
      ["/catalogo/unidades", "maestros-unidades"],
      ["/catalogo/margen-objetivo", "maestros-margen"],
      ["/catalogo/proveedores", "proveedores"],
      [`/catalogo/proveedores/${s.proveedor.id}`, "proveedor-ficha"],
      ["/catalogo/clientes", "clientes"],
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
