import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { crearMembresia } from "../setup/membresia";

/**
 * Proveedores con rutas separadas (F4, mismo patrón que Productos F1/F2):
 * la lista (`/catalogo/proveedores`), el alta (`/nuevo`), la ficha de solo
 * lectura (`/[id]`) y la edición (`/[id]/editar`). Al guardar se vuelve a
 * la ficha, con el aviso.
 */
async function crearProveedor(sufijo: number) {
  return prisma.proveedor.create({
    data: {
      codigo: `E2E-PRV-FI-${sufijo}`,
      nombre: `E2E Proveedor Ficha ${sufijo}`,
      contacto: "Juan Pérez",
      condicionesPago: "30 días",
      notas: "Entrega los martes",
    },
  });
}

test("la lista lleva a la ficha, que muestra los datos y los enlaces a los reportes", async ({ paginaAutenticada: page }) => {
  const sufijo = Date.now();
  const proveedor = await crearProveedor(sufijo);

  await page.goto("/catalogo/proveedores");
  await page.getByRole("link", { name: proveedor.nombre }).click();
  await page.waitForURL(new RegExp(`/catalogo/proveedores/${proveedor.id}$`));

  await expect(page.getByRole("heading", { name: proveedor.nombre })).toBeVisible();
  await expect(page.getByText("Juan Pérez")).toBeVisible();
  await expect(page.getByText("30 días")).toBeVisible();
  await expect(page.getByText("Entrega los martes")).toBeVisible();
  // Es solo lectura: no hay formulario, y el enlace a la comparativa está.
  await expect(page.locator("main form")).toHaveCount(0);
  await expect(page.locator('a[href="/catalogo/proveedores/comparativa"]')).toHaveCount(1);
  await expect(page.locator(`a[href="/reportes/compras?proveedorId=${proveedor.id}"]`)).toHaveCount(1);
});

test("editar y guardar vuelve a la ficha con el aviso, y la ficha muestra lo nuevo", async ({ paginaAutenticada: page }) => {
  const sufijo = Date.now();
  const proveedor = await crearProveedor(sufijo);

  await page.goto(`/catalogo/proveedores/${proveedor.id}`);
  await page.getByRole("link", { name: "Editar", exact: true }).click();
  await page.waitForURL(new RegExp(`/catalogo/proveedores/${proveedor.id}/editar$`));

  // El nombre se muestra pero no se edita.
  await expect(page.locator('input[name="nombre"]')).toHaveCount(0);
  await expect(page.getByText(proveedor.nombre, { exact: true })).toBeVisible();
  await expect(page.locator('input[name="contacto"]')).toHaveValue("Juan Pérez");
  await expect(page.locator('input[name="condicionesPago"]')).toHaveValue("30 días");

  const nuevoContacto = `Contacto editado ${sufijo}`;
  await page.locator('input[name="contacto"]').fill(nuevoContacto);
  await page.getByRole("button", { name: "Guardar cambios" }).click();

  await page.waitForURL(new RegExp(`/catalogo/proveedores/${proveedor.id}\\?guardado=cambios$`));
  await expect(page.getByRole("status")).toHaveText("Cambios guardados.");
  await expect(page.getByText(nuevoContacto)).toBeVisible();
  expect((await prisma.proveedor.findUniqueOrThrow({ where: { id: proveedor.id } })).contacto).toBe(nuevoContacto);
});

test("crear un proveedor lleva a su ficha con el aviso de que se creó", async ({ paginaAutenticada: page }) => {
  const nombre = `E2E Nuevo Proveedor Ficha ${Date.now()}`;
  await page.goto("/catalogo/proveedores");
  await page.getByRole("link", { name: "+ Nuevo proveedor" }).click();
  await page.waitForURL(/\/catalogo\/proveedores\/nuevo$/);

  await page.locator('input[name="nombre"]').fill(nombre);
  await page.getByRole("button", { name: "Crear proveedor" }).click();

  await page.waitForURL(/\/catalogo\/proveedores\/[^/]+\?guardado=alta$/);
  await expect(page.getByRole("status")).toHaveText("Proveedor creado.");
  await expect(page.getByRole("heading", { name: nombre })).toBeVisible();
});

test("los enlaces viejos `?editar=` siguen funcionando: llevan a la edición", async ({ paginaAutenticada: page }) => {
  const proveedor = await crearProveedor(Date.now());
  await page.goto(`/catalogo/proveedores?editar=${proveedor.id}`);
  await page.waitForURL(new RegExp(`/catalogo/proveedores/${proveedor.id}/editar$`));
  await expect(page.locator('input[name="contacto"]')).toHaveValue("Juan Pérez");
});

test("un proveedor que no existe da «no encontrado», no un error", async ({ paginaAutenticada: page }) => {
  const respuesta = await page.goto("/catalogo/proveedores/no-existe-este-id");
  expect(respuesta?.status()).toBe(404);
  const otra = await page.goto("/catalogo/proveedores/no-existe-este-id/editar");
  expect(otra?.status()).toBe(404);
});

test("un rol sin «Ver» de proveedores no abre la ficha, la edición ni el alta", async ({ browser, baseURL, sucursalId }) => {
  const proveedor = await crearProveedor(Date.now());
  const rol = await prisma.rol.create({ data: { nombre: `e2e-sin-proveedores-${Date.now()}` } });
  const usuario = await prisma.user.create({ data: { email: `e2e-sin-proveedores-${Date.now()}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: rol.id, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await contexto.newPage();

  for (const ruta of [`/catalogo/proveedores/${proveedor.id}`, `/catalogo/proveedores/${proveedor.id}/editar`, "/catalogo/proveedores/nuevo"]) {
    await page.goto(ruta);
    await expect(page.getByText(/No tenés permiso/).first()).toBeVisible();
  }
  await contexto.close();
});
