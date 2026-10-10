import { randomUUID } from "node:crypto";
import type { Browser, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { crearMembresia } from "../setup/membresia";

/**
 * M.2 (P6): la clave fina `producto_campos_sensibles` en las pantallas de producto. El servidor ya la exige (P2 a P5); acá se mira lo que ve y puede hacer la persona en el navegador:
 *  - con la clave (el administrador de la semilla): los campos de siempre, editables, y «Agregar» una presentación;
 *  - sin la clave: precio de venta, factor y unidades como SOLO LECTURA con el valor guardado y el permiso que hace falta, sin «Agregar» presentación, y el alta se ve como la crea el servidor
 *    (precio 0, factor 1, sin unidad de compra; M.2-A4: un producto de venta nace NO disponible, con el tilde apagado y un aviso visible); guardar un cambio de nombre no toca lo sensible, ni siquiera si otra persona lo cambió mientras tanto;
 *  - un formulario abierto ANTES de que le quiten la clave: el rechazo del servidor llega y se lee, y no se escribe nada.
 * Rol propio y usuario propio por caso (el rol `operador` compartido lo mutan otros specs).
 */
const CLAVES_SIN_LA_FINA = ["alta_producto", "producto_editar", "producto_presentaciones", "producto_ver_catalogo"];
const MENSAJE_SIN_PERMISO = "No tenés permiso para cambiar el precio de venta, el factor de conversión ni las unidades del producto.";

async function abrirComoRol(browser: Browser, baseURL: string | undefined, sucursalId: string, opciones: { conClaveFina: boolean }) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const rol = await prisma.rol.create({ data: { nombre: `e2e-sensibles-${opciones.conClaveFina ? "con" : "sin"}-${marca}` } });
  const claves = opciones.conClaveFina ? [...CLAVES_SIN_LA_FINA, "producto_campos_sensibles"] : CLAVES_SIN_LA_FINA;
  for (const accionClave of claves) await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave, puedeVer: true, puedeEditar: true } });
  const usuario = await prisma.user.create({ data: { email: `e2e-sensibles-${marca}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: rol.id, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await contexto.newPage();
  return {
    page,
    quitarLaClaveFina: () => prisma.permisoRol.deleteMany({ where: { rolId: rol.id, accionClave: "producto_campos_sensibles" } }),
    limpiar: async () => {
      await contexto.close();
      await prisma.session.deleteMany({ where: { userId: usuario.id } });
      await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: usuario.id } });
      await prisma.usuarioEmpresa.deleteMany({ where: { usuarioId: usuario.id } });
      await prisma.user.deleteMany({ where: { id: usuario.id } });
      await prisma.permisoRol.deleteMany({ where: { rolId: rol.id } });
      await prisma.rol.deleteMany({ where: { id: rol.id } });
    },
  };
}

/** Una materia prima en kg que se compra en «g» a factor 25, con una presentación alternativa en «l» (factor 4), disponible en la sucursal, y un producto de venta a $100. */
async function sembrarProductos(sucursalId: string) {
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const [kg, g, l, ml] = await Promise.all(["kg", "g", "l", "ml"].map((nombre) => prisma.unidad.findFirstOrThrow({ where: { nombre } })));
  const mp = await prisma.producto.create({
    data: { codigo: `E2E-SENS-MP-${marca}`, nombre: `E2E Sensibles MP ${marca}`, tipo: "MP", unidadStockId: kg.id, unidadCompraId: g.id, factorConversion: 25 },
  });
  const pv = await prisma.producto.create({ data: { codigo: `E2E-SENS-PV-${marca}`, nombre: `E2E Sensibles PV ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  await prisma.presentacion.create({ data: { productoId: mp.id, unidadCompraId: l.id, factorConversion: 4 } });
  await prisma.disponibilidadProducto.createMany({ data: [mp, pv].map((p) => ({ sucursalId, productoId: p.id, disponible: true })) });
  return {
    mp,
    pv,
    kg,
    g,
    l,
    ml,
    marca,
    limpiar: async () => {
      await prisma.presentacion.deleteMany({ where: { productoId: mp.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: { in: [mp.id, pv.id] } } });
      await prisma.producto.deleteMany({ where: { id: { in: [mp.id, pv.id] } } });
    },
  };
}

/** CampoNumero muestra el número formateado y pasa al crudo al tomar el foco: primero el foco, después se reemplaza el valor. */
async function escribirNumero(page: Page, etiqueta: string, valor: string) {
  const campo = page.getByLabel(etiqueta, { exact: true });
  await campo.focus();
  await campo.fill(valor);
  await campo.blur();
}

const soloLectura = (page: Page, campo: string) => page.locator(`[data-solo-lectura="${campo}"]`);
const aviso = (page: Page) => page.locator("[data-aviso-campos-sensibles]");
const sinPoderVender = (page: Page) => page.locator("[data-aviso-alta-sin-precio]");

test("el administrador (con la clave) ve los campos editables y sin avisos, y cambia el factor y agrega una presentación", async ({ paginaAutenticada: page, sucursalId }) => {
  const { mp, pv, ml, limpiar } = await sembrarProductos(sucursalId);
  try {
    await page.goto(`/catalogo/productos/${mp.id}/editar`);
    await expect(page.locator('input[name="nombre"]')).toHaveValue(mp.nombre);
    await expect(page.locator("[data-solo-lectura]")).toHaveCount(0);
    await expect(aviso(page)).toHaveCount(0);
    await expect(page.locator("[data-aviso-presentaciones-sin-permiso]")).toHaveCount(0);
    await expect(page.getByLabel("Unidad de stock")).toBeEnabled();
    await expect(page.getByLabel("Unidad de compra", { exact: true })).toBeEnabled();

    await escribirNumero(page, "Factor de conversión (unidades de stock por unidad de compra)", "30");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.waitForURL(new RegExp(`/catalogo/productos/${mp.id}\\?guardado=cambios$`));
    expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: mp.id } })).factorConversion)).toBe(30);

    // Una presentación nueva en «ml» (la «g» es la unidad de compra por defecto y la «l» ya es una presentación).
    await page.goto(`/catalogo/productos/${mp.id}/editar`);
    await page.locator("label", { hasText: "Unidad de compra" }).locator("select").selectOption({ label: "ml" });
    const factorPresentacion = page.locator("label", { hasText: "Factor de conversión" }).locator("input[type=text]");
    await factorPresentacion.focus();
    await factorPresentacion.fill("50");
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(page.getByRole("cell", { name: "50", exact: true })).toBeVisible();
    expect(Number((await prisma.presentacion.findFirstOrThrow({ where: { productoId: mp.id, unidadCompraId: ml.id } })).factorConversion)).toBe(50);

    // Un producto de venta: el precio editable.
    await page.goto(`/catalogo/productos/${pv.id}/editar`);
    await expect(page.getByLabel("Precio de venta", { exact: true })).toBeVisible();
    await expect(soloLectura(page, "precioVenta")).toHaveCount(0);
  } finally {
    await limpiar();
  }
});

test("sin la clave, la edición de una materia prima muestra factor y unidades guardados como solo lectura, sin «Agregar» presentación, y guardar el nombre no toca lo sensible", async ({ browser, baseURL, sucursalId }) => {
  const { mp, kg, g, limpiar: limpiarProductos } = await sembrarProductos(sucursalId);
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { conClaveFina: false });
  try {
    await page.goto(`/catalogo/productos/${mp.id}/editar`);
    await expect(page.locator('input[name="nombre"]')).toHaveValue(mp.nombre);
    await expect(soloLectura(page, "unidadStockId")).toContainText("kg");
    await expect(soloLectura(page, "unidadCompraId")).toContainText("g");
    await expect(soloLectura(page, "factorConversion")).toContainText("25");
    await expect(aviso(page)).toContainText("campos sensibles del producto");
    // Nada que se pueda editar de lo sensible: ni el factor, ni las unidades, ni «Agregar» una presentación (la lista y su Activar/Desactivar siguen).
    await expect(page.getByLabel("Factor de conversión (unidades de stock por unidad de compra)")).toHaveCount(0);
    await expect(page.getByLabel("Unidad de stock")).toHaveCount(0);
    await expect(page.getByLabel("Unidad de compra", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Agregar", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Desactivar" })).toBeVisible();
    await expect(page.locator("[data-aviso-presentaciones-sin-permiso]")).toContainText("campos sensibles del producto");

    const nuevoNombre = `${mp.nombre} renombrada`;
    await page.locator('input[name="nombre"]').fill(nuevoNombre);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.waitForURL(new RegExp(`/catalogo/productos/${mp.id}\\?guardado=cambios$`));
    const guardado = await prisma.producto.findUniqueOrThrow({ where: { id: mp.id } });
    expect([guardado.nombre, Number(guardado.factorConversion), guardado.unidadStockId, guardado.unidadCompraId]).toEqual([nuevoNombre, 25, kg.id, g.id]);
  } finally {
    await limpiar();
    await limpiarProductos();
  }
});

test("sin la clave, el precio de un producto de venta es solo lectura y un cambio de precio de otra persona mientras se edita no se pisa al guardar", async ({ browser, baseURL, sucursalId }) => {
  const { pv, limpiar: limpiarProductos } = await sembrarProductos(sucursalId);
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { conClaveFina: false });
  try {
    await page.goto(`/catalogo/productos/${pv.id}/editar`);
    await expect(page.locator('input[name="nombre"]')).toHaveValue(pv.nombre);
    await expect(soloLectura(page, "precioVenta")).toContainText("$100");
    await expect(page.getByLabel("Precio de venta", { exact: true })).toHaveCount(0);
    await expect(aviso(page)).toBeVisible();

    // Mientras esta persona tiene el formulario abierto, un administrador sube el precio: guardar el nombre no puede devolverlo a $100.
    await prisma.producto.update({ where: { id: pv.id }, data: { precioVenta: 250 } });
    await page.locator('input[name="nombre"]').fill(`${pv.nombre} renombrado`);
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await page.waitForURL(new RegExp(`/catalogo/productos/${pv.id}\\?guardado=cambios$`));
    const guardado = await prisma.producto.findUniqueOrThrow({ where: { id: pv.id } });
    expect([guardado.nombre, Number(guardado.precioVenta)]).toEqual([`${pv.nombre} renombrado`, 250]);
  } finally {
    await limpiar();
    await limpiarProductos();
  }
});

test("sin la clave, el alta se ve como la crea el servidor (precio 0, factor 1, sin unidad de compra) y crea el producto así", async ({ browser, baseURL, sucursalId }) => {
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { conClaveFina: false });
  const nombre = `E2E Alta Sin Clave ${Date.now()}`;
  try {
    await page.goto("/catalogo/productos/nuevo");
    await expect(page.locator('input[name="nombre"]')).toBeVisible();
    await expect(soloLectura(page, "factorConversion")).toContainText("1");
    await expect(soloLectura(page, "unidadCompraId")).toContainText("Sin unidad de compra");
    await expect(page.getByLabel("Factor de conversión (unidades de stock por unidad de compra)")).toHaveCount(0);
    await expect(page.getByLabel("Unidad de compra", { exact: true })).toHaveCount(0);
    await expect(aviso(page)).toContainText("campos sensibles del producto");
    // La unidad de stock del alta queda libre (el servidor no la protege: sin ella no hay producto).
    await expect(page.getByLabel("Unidad de stock")).toBeEnabled();

    // Una materia prima no se vende: el tilde de las sucursales sigue libre y sin aviso.
    await expect(page.getByLabel("Activo en todas las sucursales")).toBeEnabled();
    await expect(page.getByLabel("Activo en todas las sucursales")).toBeChecked();
    await expect(sinPoderVender(page)).toHaveCount(0);

    await page.getByLabel("Producto de venta (PV)").check();
    await expect(soloLectura(page, "precioVenta")).toContainText("$0");
    await expect(page.getByLabel("Precio de venta", { exact: true })).toHaveCount(0);
    // M.2-A4: un PV sin la clave nace sin precio, así que NO se puede vender: el tilde se ve apagado y sin poder cambiarse, y un aviso (visible, no una ayuda gris) lo dice.
    await expect(page.getByLabel("Activo en todas las sucursales")).toBeDisabled();
    await expect(page.getByLabel("Activo en todas las sucursales")).not.toBeChecked();
    await expect(sinPoderVender(page)).toBeVisible();
    await expect(sinPoderVender(page)).toContainText("No se va a poder vender todavía");
    await expect(sinPoderVender(page)).toContainText("campos sensibles del producto");

    await page.locator('input[name="nombre"]').fill(nombre);
    await page.getByLabel("Unidad de stock").selectOption({ label: "unidad" });
    await page.getByRole("button", { name: "Crear producto" }).click();
    await page.waitForURL(/\/catalogo\/productos\/[^/?]+\?guardado=alta$/);
    const creado = await prisma.producto.findFirstOrThrow({ where: { nombre } });
    expect([Number(creado.precioVenta), Number(creado.factorConversion), creado.unidadCompraId]).toEqual([0, 1, null]);
    // …y el servidor lo dejó NO disponible en ninguna sucursal (la ficha lo dice: el POS y la carta pública solo ofrecen lo disponible).
    const filas = await prisma.disponibilidadProducto.findMany({ where: { productoId: creado.id } });
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.some((f) => f.disponible)).toBe(false);
    await expect(page.getByText(/No disponible en «/)).toBeVisible();
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: creado.id } });
    await prisma.producto.deleteMany({ where: { id: creado.id } });
  } finally {
    await limpiar();
  }
});

test("un formulario de edición abierto ANTES de que le quiten la clave: el rechazo del servidor se lee y el precio no se escribe", async ({ browser, baseURL, sucursalId }) => {
  const { pv, limpiar: limpiarProductos } = await sembrarProductos(sucursalId);
  const { page, quitarLaClaveFina, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { conClaveFina: true });
  try {
    await page.goto(`/catalogo/productos/${pv.id}/editar`);
    await expect(page.getByLabel("Precio de venta", { exact: true })).toBeVisible(); // con la clave, editable
    await quitarLaClaveFina();
    await escribirNumero(page, "Precio de venta", "999");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText(MENSAJE_SIN_PERMISO)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/catalogo/productos/${pv.id}/editar$`));
    expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: pv.id } })).precioVenta)).toBe(100);
  } finally {
    await limpiar();
    await limpiarProductos();
  }
});

test("un formulario abierto ANTES de que le quiten la clave: «Agregar» una presentación muestra el rechazo y no crea nada", async ({ browser, baseURL, sucursalId }) => {
  const { mp, ml, limpiar: limpiarProductos } = await sembrarProductos(sucursalId);
  const { page, quitarLaClaveFina, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { conClaveFina: true });
  try {
    await page.goto(`/catalogo/productos/${mp.id}/editar`);
    await expect(page.getByRole("button", { name: "Agregar", exact: true })).toBeVisible();
    await quitarLaClaveFina();
    await page.locator("label", { hasText: "Unidad de compra" }).locator("select").selectOption({ label: "ml" });
    const factorPresentacion = page.locator("label", { hasText: "Factor de conversión" }).locator("input[type=text]");
    await factorPresentacion.focus();
    await factorPresentacion.fill("50");
    await page.getByRole("button", { name: "Agregar", exact: true }).click();
    await expect(page.getByText(MENSAJE_SIN_PERMISO)).toBeVisible();
    expect(await prisma.presentacion.count({ where: { productoId: mp.id, unidadCompraId: ml.id } })).toBe(0);
  } finally {
    await limpiar();
    await limpiarProductos();
  }
});

test("accesibilidad (axe) sin la clave: la edición de una materia prima y de un producto de venta en solo lectura, y el alta, en modo claro y oscuro", async ({ browser, baseURL, sucursalId }) => {
  const { mp, pv, limpiar: limpiarProductos } = await sembrarProductos(sucursalId);
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { conClaveFina: false });
  const sinViolaciones = async (que: string) => {
    expect((await new AxeBuilder({ page }).analyze()).violations, `${que}, modo claro`).toEqual([]);
    // Modo oscuro: solo lo que dibuja esta tarea (el solo lectura y los avisos). Las ayudas de campo de TODO el formulario (`AyudaCampo`, `text-neutral-500`) ya no alcanzan el contraste en oscuro: es de antes y
    // de toda la aplicación, no de este cambio.
    await page.emulateMedia({ colorScheme: "dark" });
    let oscuro = new AxeBuilder({ page });
    for (const selector of ["[data-solo-lectura]", "[data-aviso-campos-sensibles]", "[data-aviso-presentaciones-sin-permiso]", "[data-aviso-alta-sin-precio]"]) {
      if ((await page.locator(selector).count()) > 0) oscuro = oscuro.include(selector); // axe falla si un `include` no encuentra nada
    }
    expect((await oscuro.analyze()).violations, `${que}, modo oscuro (lo nuevo)`).toEqual([]);
    await page.emulateMedia({ colorScheme: "light" });
  };
  try {
    await page.goto(`/catalogo/productos/${mp.id}/editar`);
    await expect(soloLectura(page, "factorConversion")).toBeVisible();
    await sinViolaciones("edición de materia prima en solo lectura");

    await page.goto(`/catalogo/productos/${pv.id}/editar`);
    await expect(soloLectura(page, "precioVenta")).toBeVisible();
    await sinViolaciones("edición de producto de venta en solo lectura");

    await page.goto("/catalogo/productos/nuevo");
    await expect(soloLectura(page, "factorConversion")).toBeVisible();
    await sinViolaciones("alta de materia prima sin la clave");
    await page.getByLabel("Producto de venta (PV)").check();
    await expect(soloLectura(page, "precioVenta")).toBeVisible();
    await expect(sinPoderVender(page)).toBeVisible();
    await sinViolaciones("alta de producto de venta sin la clave (con el aviso de que no se podrá vender)");
  } finally {
    await limpiar();
    await limpiarProductos();
  }
});

test("la matriz de permisos lista la clave nueva con su descripción en español", async ({ paginaAutenticada: page }) => {
  await page.goto("/administracion/permisos");
  const fila = page.getByRole("row").filter({ has: page.getByText("producto_campos_sensibles", { exact: true }) });
  await expect(fila).toHaveCount(1);
  await expect(fila).toContainText("Cambiar el precio de venta, el factor de conversión y las unidades de un producto, y definir el factor de sus presentaciones de compra");
  await expect(fila).not.toContainText("Piso:"); // clase O: piso operario, delegable por configuración
});
