import { randomUUID } from "node:crypto";
import type { Browser } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { crearMembresia } from "../setup/membresia";

/**
 * Permiso de EDITAR productos (`editar_producto`), distinto del de Ver de la familia (`alta_producto`). Con la semilla de fábrica NO existe un rol que
 * vea productos y no los edite (admin y operador tienen los dos), así que cada caso fabrica el suyo: rol propio, usuario propio, sesión propia.
 * Nada depende del rol `operador` compartido (otros specs lo mutan).
 */
/** `editarProducto`: Ver+Editar de `editar_producto`. `altaEditar`: Editar (además de Ver) de `alta_producto`, el permiso del alta. Por defecto solo Ver de `alta_producto`. */
async function abrirComoRol(browser: Browser, baseURL: string | undefined, sucursalId: string, permisos: { editarProducto?: boolean; altaEditar?: boolean }) {
  const { editarProducto: puedeEditarProducto = false, altaEditar = false } = permisos;
  const marca = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const rol = await prisma.rol.create({ data: { nombre: `e2e-productos-${puedeEditarProducto ? "edita" : "solo-ve"}-${marca}` } });
  await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: "alta_producto", puedeVer: true, puedeEditar: altaEditar } });
  if (puedeEditarProducto) await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: "editar_producto", puedeVer: true, puedeEditar: true } });
  const usuario = await prisma.user.create({ data: { email: `e2e-productos-${marca}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: rol.id, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await contexto.newPage();
  return {
    page,
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

async function crearProducto(marca: number, sucursalId: string) {
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-PE-${marca}`, nombre: `E2E Permiso Editar ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 100 } });
  // La columna "Disponible acá"/el botón «Desactivar» (P10) dependen de una fila real, no del activo global — sin esto el producto siempre aparece "No disponible".
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  return producto;
}

test("un rol que solo VE productos no abre /editar por URL directa: no se dibuja el formulario", async ({ browser, baseURL, sucursalId }) => {
  const producto = await crearProducto(Date.now(), sucursalId);
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, {});
  try {
    await page.goto(`/catalogo/productos/${producto.id}/editar`);
    await expect(page.getByText(/No tenés permiso/).first()).toBeVisible();
    await expect(page.locator('input[name="nombre"]'), "el formulario de edición no tenía que llegar a dibujarse").toHaveCount(0);
  } finally {
    await limpiar();
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

test("un rol CON editar_producto sí abre /editar y ve el formulario con el nombre cargado", async ({ browser, baseURL, sucursalId }) => {
  // Contraespejo del caso anterior: impide «arreglarlo» cerrando la ruta para todos.
  const producto = await crearProducto(Date.now(), sucursalId);
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { editarProducto: true });
  try {
    await page.goto(`/catalogo/productos/${producto.id}/editar`);
    await expect(page.locator('input[name="nombre"]')).toHaveValue(producto.nombre);
  } finally {
    await limpiar();
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

test("un rol que solo VE productos no tiene enlace «Editar» ni en la lista ni en la ficha", async ({ browser, baseURL, sucursalId }) => {
  const producto = await crearProducto(Date.now(), sucursalId);
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, {});
  const enlaceEditar = page.locator(`a[href="/catalogo/productos/${producto.id}/editar"]`);
  try {
    await page.goto(`/catalogo/productos?q=${encodeURIComponent(producto.nombre)}`);
    await expect(page.getByRole("link", { name: producto.nombre })).toBeVisible(); // la fila está: es la lista, no un mensaje de permiso
    await expect(enlaceEditar, "el enlace «Editar» de la lista no tenía que mostrarse").toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Des)?[Aa]ctivar$/ }), "«Desactivar» de la lista no tenía que mostrarse").toHaveCount(0);

    await page.goto(`/catalogo/productos/${producto.id}`);
    await expect(page.getByRole("heading", { name: producto.nombre })).toBeVisible();
    await expect(enlaceEditar, "el botón «Editar» de la ficha no tenía que mostrarse").toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Des)?[Aa]ctivar$/ }), "«Desactivar» de la ficha no tenía que mostrarse").toHaveCount(0);
  } finally {
    await limpiar();
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

test("un rol CON editar_producto ve «Editar» en la lista y en la ficha, y lleva al formulario", async ({ browser, baseURL, sucursalId }) => {
  // Contraespejo: impide «arreglarlo» escondiendo el enlace para todos.
  const producto = await crearProducto(Date.now(), sucursalId);
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { editarProducto: true });
  const enlaceEditar = page.locator(`a[href="/catalogo/productos/${producto.id}/editar"]`);
  try {
    await page.goto(`/catalogo/productos?q=${encodeURIComponent(producto.nombre)}`);
    await expect(enlaceEditar).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Desactivar", exact: true })).toBeVisible();

    await page.goto(`/catalogo/productos/${producto.id}`);
    await expect(enlaceEditar).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Desactivar", exact: true })).toBeVisible();
    await enlaceEditar.click();
    await expect(page.locator('input[name="nombre"]')).toHaveValue(producto.nombre);
  } finally {
    await limpiar();
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});

test("un rol que solo VE productos no abre /nuevo por URL directa y no tiene el botón «+ Nuevo producto»", async ({ browser, baseURL, sucursalId }) => {
  // El alta la guarda `alta_producto` con permiso de EDITAR; la página solo pedía el de Ver (mismo hueco que /editar).
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, {});
  try {
    await page.goto("/catalogo/productos/nuevo");
    await expect(page.getByText(/No tenés permiso/).first()).toBeVisible();
    await expect(page.locator('input[name="nombre"]'), "el formulario de alta no tenía que llegar a dibujarse").toHaveCount(0);

    await page.goto("/catalogo/productos");
    await expect(page.getByRole("heading", { name: "Productos", exact: true })).toBeVisible(); // es la lista, no un mensaje de permiso
    await expect(page.locator('a[href="/catalogo/productos/nuevo"]'), "«+ Nuevo producto» no tenía que mostrarse").toHaveCount(0);
  } finally {
    await limpiar();
  }
});

test("un rol CON permiso de editar el alta ve «+ Nuevo producto» y el formulario de /nuevo", async ({ browser, baseURL, sucursalId }) => {
  // Contraespejo: impide «arreglarlo» cerrando el alta para todos.
  const { page, limpiar } = await abrirComoRol(browser, baseURL, sucursalId, { altaEditar: true });
  try {
    await page.goto("/catalogo/productos");
    await page.locator('a[href="/catalogo/productos/nuevo"]').click();
    await expect(page.locator('input[name="nombre"]')).toBeVisible();
  } finally {
    await limpiar();
  }
});
