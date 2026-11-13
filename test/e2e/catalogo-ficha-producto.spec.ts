import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { crearMembresia } from "../setup/membresia";
import { sembrarGrupo } from "./fixtures/opciones";
import { expectObjetivosTactiles, expectSinDesborde } from "./fixtures/movil";

/**
 * Productos con rutas separadas: la lista (`/catalogo/productos`), el alta (`/nuevo`), la ficha de solo lectura (`/[id]`) y la edición
 * (`/[id]/datos`, el paso 1 del espacio del producto; la ruta vieja `/[id]/editar` se borró el 2026-10-28, con el OK del dueño). Al guardar se vuelve a la ficha, que muestra el aviso (antes se volvía a la lista y el aviso se perdía).
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
  // La pestaña Datos es el formulario con los datos cargados.
  await expect(page.locator("select option:checked", { hasText: `E2E Categoría Ficha ${sufijo}` })).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Precio de venta" })).toHaveValue(/4\.?500/);
  await expect(page.locator('textarea[name="observaciones"]')).toHaveCount(0); // oculto con el interruptor; el dato queda guardado
  // Los enlaces a los reportes que ya existen están.
  await expect(page.locator(`a[href="/reportes/historial?productoId=${producto.id}"]`)).toHaveCount(1);
  await expect(page.locator('a[href="/reportes/costos"]').first()).toBeVisible();
  // La receta es un paso del espacio (una pestaña del marco): el enlace es UNO, no dos.
  await expect(page.locator(`a[href="/catalogo/recetas/${producto.id}"]`)).toHaveCount(1);
});

test("la ficha de un producto de venta es la portada del espacio: el nombre es el h1 y las tres pestañas son de la ficha (sin Receta ni En la carta), con «Datos» como pantalla actual", async ({ paginaAutenticada: page }) => {
  const producto = await crearProducto(Date.now());
  await page.goto(`/catalogo/productos/${producto.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(producto.nombre);
  const pasos = page.getByRole("navigation", { name: "Pasos del producto" });
  await expect(pasos.getByRole("link", { name: "Datos" })).toHaveAttribute("aria-current", "page");
  await expect(pasos.getByRole("link", { name: "Datos" })).toHaveAttribute("href", `/catalogo/productos/${producto.id}`);
  await expect(pasos.getByRole("link", { name: "Precios" })).toHaveAttribute("href", `/catalogo/productos/${producto.id}/precios`);
  await expect(pasos.getByRole("link", { name: /^Opciones/ })).toHaveAttribute("href", `/catalogo/productos/${producto.id}/opciones`);
  // Receta y «En la carta» están fuera de la ficha (dueño, 2026-11-13): no hay pestaña ni enlace en la tira.
  await expect(pasos).not.toContainText("Receta");
  await expect(pasos).not.toContainText("En la carta");
  // Sin receta no se vende: la portada lo dice en «Qué falta», y ese aviso lleva a la receta.
  await expect(page.getByRole("heading", { name: "Qué falta" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Receta", exact: true })).toHaveAttribute("href", `/catalogo/recetas/${producto.id}`);
  await expect(page.getByText(/no tiene receta: armala en Catálogo/)).toBeVisible();
  // Contraespejo: Datos y Precios están completos (tiene precio): no son un pendiente.
  await expect(pasos.getByRole("link", { name: "Precios" })).not.toContainText("Pendiente");
  // La pestaña Datos ES el formulario de los datos, con el nombre cargado (y el enlace viejo /datos lleva a la misma pantalla).
  await expect(page.locator('input[name="nombre"]')).toHaveValue(producto.nombre);
  await page.goto(`/catalogo/productos/${producto.id}/datos`);
  await expect(page).toHaveURL(new RegExp(`/catalogo/productos/${producto.id}$`));
  await expect(page.getByRole("navigation", { name: "Pasos del producto" }).getByRole("link", { name: "Datos" })).toHaveAttribute("aria-current", "page");
});

test("a 375 px la portada del espacio no se sale por la derecha y los pasos se tocan con el dedo (la tira se desplaza, la página no)", async ({ paginaAutenticada: page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const producto = await crearProducto(Date.now());
  await page.goto(`/catalogo/productos/${producto.id}`);
  const pasos = page.getByRole("navigation", { name: "Pasos del producto" });
  await expect(pasos).toBeVisible();
  await expectSinDesborde(page, "portada del producto a 375 px");
  await expectObjetivosTactiles(pasos.getByRole("link"), "pasos de la portada a 375 px", { alto: 44 });
});

test("una materia prima tiene el mismo espacio con menos pasos: solo Datos (sin Opciones, Receta ni En la carta); si se produce y no tiene receta, «Qué falta» lleva a la receta", async ({ paginaAutenticada: page }) => {
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const marca = Date.now();
  const harina = await prisma.producto.create({ data: { codigo: `E2E-FI-H-${marca}`, nombre: `E2E Harina ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const masa = await prisma.producto.create({ data: { codigo: `E2E-FI-M-${marca}`, nombre: `E2E Masa ${marca}`, tipo: "MP", unidadStockId: kg.id, seProduce: true } });
  await page.goto(`/catalogo/productos/${harina.id}`);
  const pasos = page.getByRole("navigation", { name: "Pasos del producto" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(harina.nombre);
  await expect(pasos.getByRole("link")).toHaveText(["Datos"]);
  await expect(pasos.getByRole("link", { name: "Datos" })).toHaveAttribute("href", `/catalogo/productos/${harina.id}`);
  await page.goto(`/catalogo/productos/${masa.id}`);
  await expect(pasos.getByRole("link")).toHaveText(["Datos"]);
  // La materia prima que se produce y no tiene receta lo dice en «Qué falta», con el enlace a la receta; la que no se produce no tiene paso de receta.
  await expect(page.getByRole("link", { name: "Receta", exact: true })).toHaveAttribute("href", `/catalogo/recetas/${masa.id}`);
  await expect(page.getByText(/se produce y todavía no tiene receta/)).toBeVisible();
});

test("el producto de respaldo de un adicional se muestra sin el marco de venta: ni pestañas ni «Qué falta», con su «Editar» al paso 1", async ({ paginaAutenticada: page }) => {
  const marca = Date.now();
  const grupo = await sembrarGrupo({ nombre: `E2E Extras ficha ${marca}`, tipo: "ADICIONAL", cantidadMinima: 0, cantidadMaxima: 2, marca: String(marca), opciones: [{ nombre: "Huevo frito", monto: 600, conAncla: true }] });
  const ancla = grupo.opciones["Huevo frito"].anclaId!;
  await page.goto(`/catalogo/productos/${ancla}`);
  await expect(page.getByText(/producto interno que respalda el stock de un adicional/)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Pasos del producto" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Qué falta" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Editar", exact: true })).toHaveAttribute("href", `/catalogo/productos/${ancla}/datos`);
});

test("editar y guardar vuelve a la ficha con el aviso, y la ficha muestra lo nuevo", async ({ paginaAutenticada: page }) => {
  const sufijo = Date.now();
  const producto = await crearProducto(sufijo);

  await page.goto(`/catalogo/productos/${producto.id}`);
  // El editor está en la ficha misma (pestaña Datos).

  const nuevoNombre = `E2E Ficha Editado ${sufijo}`;
  await page.locator('input[name="nombre"]').fill(nuevoNombre);
  await page.getByRole("button", { name: "Guardar cambios" }).click();

  await page.waitForURL(new RegExp(`/catalogo/productos/${producto.id}\\?guardado=cambios$`));
  await expect(page.getByRole("status")).toContainText("actualizado");
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

test("un producto que no existe da «no encontrado», no un error", async ({ paginaAutenticada: page }) => {
  const respuesta = await page.goto("/catalogo/productos/no-existe-este-id");
  expect(respuesta?.status()).toBe(404);
  const datos = await page.goto("/catalogo/productos/no-existe-este-id/datos");
  expect(datos?.status()).toBe(404);
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

  for (const ruta of [`/catalogo/productos/${producto.id}`, `/catalogo/productos/${producto.id}/datos`, "/catalogo/productos/nuevo"]) {
    await page.goto(ruta);
    await expect(page.getByText(/No tenés permiso/).first()).toBeVisible();
  }
  await contexto.close();
});
