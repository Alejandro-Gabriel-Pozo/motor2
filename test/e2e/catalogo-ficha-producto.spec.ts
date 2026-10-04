import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { crearMembresia } from "../setup/membresia";

/**
 * Productos con rutas separadas: la lista (`/catalogo/productos`), el alta (`/nuevo`), la ficha de solo lectura (`/[id]`) y la edición
 * (`/[id]/editar`). Al guardar se vuelve a la ficha, que muestra el aviso (antes se volvía a la lista y el aviso se perdía).
 */
async function crearProducto(sufijo: number) {
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const categoria = await prisma.categoriaProducto.create({ data: { nombre: `E2E Categoría Ficha ${sufijo}` } });
  return prisma.producto.create({
    data: {
      codigo: `E2E-FI-${sufijo}`,
      nombre: `E2E Ficha ${sufijo}`,
      tipo: "PV",
      categoriaId: categoria.id,
      unidadStockId: unidad.id,
      unidadCompraId: unidad.id,
      precioVenta: 4500,
      observaciones: "Observación de la ficha",
    },
  });
}

test("la lista lleva a la ficha, que muestra los datos y los enlaces a los reportes", async ({ paginaAutenticada: page }) => {
  const sufijo = Date.now();
  const producto = await crearProducto(sufijo);

  await page.goto(`/catalogo/productos?q=${encodeURIComponent(producto.nombre)}`);
  await page.getByRole("link", { name: producto.nombre }).click();
  await page.waitForURL(new RegExp(`/catalogo/productos/${producto.id}$`));

  await expect(page.getByRole("heading", { name: producto.nombre })).toBeVisible();
  await expect(page.getByText(`E2E Categoría Ficha ${sufijo}`)).toBeVisible();
  await expect(page.getByText("$4.500")).toBeVisible();
  await expect(page.getByText("Observación de la ficha")).toBeVisible();
  // Es solo lectura: no hay formulario, y los enlaces a los reportes que ya existen están.
  await expect(page.locator("main form")).toHaveCount(0);
  await expect(page.locator(`a[href="/reportes/historial?productoId=${producto.id}"]`)).toHaveCount(1);
  await expect(page.locator('a[href="/reportes/costos"]').first()).toBeVisible();
  await expect(page.locator(`a[href="/catalogo/recetas/${producto.id}"]`)).toHaveCount(1);
});

test("editar y guardar vuelve a la ficha con el aviso, y la ficha muestra lo nuevo", async ({ paginaAutenticada: page }) => {
  const sufijo = Date.now();
  const producto = await crearProducto(sufijo);

  await page.goto(`/catalogo/productos/${producto.id}`);
  await page.getByRole("link", { name: "Editar", exact: true }).click();
  await page.waitForURL(new RegExp(`/catalogo/productos/${producto.id}/editar$`));

  const nuevoNombre = `E2E Ficha Editado ${sufijo}`;
  await page.locator('input[name="nombre"]').fill(nuevoNombre);
  await page.getByRole("button", { name: "Guardar cambios" }).click();

  await page.waitForURL(new RegExp(`/catalogo/productos/${producto.id}\\?guardado=cambios$`));
  await expect(page.getByRole("status")).toHaveText("Cambios guardados.");
  await expect(page.getByRole("heading", { name: nuevoNombre })).toBeVisible();
  expect((await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).nombre).toBe(nuevoNombre);
});

test("crear un producto lleva a su ficha con el aviso de que se creó", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Nuevo Ficha ${Date.now()}`;
  await page.goto("/catalogo/productos");
  await page.getByRole("link", { name: "+ Nuevo producto" }).click();
  await page.waitForURL(/\/catalogo\/productos\/nuevo$/);

  await page.locator('input[name="nombre"]').fill(nombre);
  await page.locator("select[required]").selectOption({ label: "kg" });
  await page.getByRole("button", { name: "Crear producto" }).click();

  await page.waitForURL(/\/catalogo\/productos\/[^/]+\?guardado=alta$/);
  await expect(page.getByRole("status")).toHaveText("Producto creado.");
  await expect(page.getByRole("heading", { name: nombre })).toBeVisible();
});

test("los enlaces viejos `?id=` siguen funcionando: llevan a la edición", async ({ paginaAutenticada: page }) => {
  const producto = await crearProducto(Date.now());
  await page.goto(`/catalogo/productos?id=${producto.id}`);
  await page.waitForURL(new RegExp(`/catalogo/productos/${producto.id}/editar$`));
  await expect(page.locator('input[name="nombre"]')).toHaveValue(producto.nombre);
});

test("un producto que no existe da «no encontrado», no un error", async ({ paginaAutenticada: page }) => {
  const respuesta = await page.goto("/catalogo/productos/no-existe-este-id");
  expect(respuesta?.status()).toBe(404);
  const otra = await page.goto("/catalogo/productos/no-existe-este-id/editar");
  expect(otra?.status()).toBe(404);
});

test("un rol sin «Ver» de productos no abre la ficha, la edición ni el alta", async ({ browser, baseURL, sucursalId }) => {
  const producto = await crearProducto(Date.now());
  const rol = await prisma.rol.create({ data: { nombre: `e2e-sin-productos-${Date.now()}` } });
  const usuario = await prisma.user.create({ data: { email: `e2e-sin-productos-${Date.now()}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: rol.id, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await contexto.newPage();

  for (const ruta of [`/catalogo/productos/${producto.id}`, `/catalogo/productos/${producto.id}/editar`, "/catalogo/productos/nuevo"]) {
    await page.goto(ruta);
    await expect(page.getByText(/No tenés permiso/).first()).toBeVisible();
  }
  await contexto.close();
});
