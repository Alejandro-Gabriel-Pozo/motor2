import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Las escrituras (`conPermiso`) con la sesión vencida llevan al login. Antes devolvían «No autenticado…» como un error más
 * dentro del formulario y quien solo enviaba formularios (sin tocar nunca un buscador, que es lo que dispara una lectura y con
 * ella el redirect) se quedaba con un mensaje críptico y sin forma de saber qué hacer. Complementa a lecturas-sesion-vencida.spec.ts.
 */
test("enviar un formulario con la sesión vencida lleva al login, en vez de mostrar «No autenticado»", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/proveedores/nuevo");
  await expect(page.getByText("Nuevo proveedor")).toBeVisible();
  const nombre = `E2E Proveedor Sin Sesión ${Date.now()}`;
  await page.locator('input[name="nombre"]').fill(nombre);

  // La sesión vence con la pestaña abierta.
  await prisma.session.deleteMany({ where: { user: { email: "e2e-admin@local.test" } } });

  await page.getByRole("button", { name: "Crear proveedor", exact: true }).click();

  await page.waitForURL(/\/login/);
  // La escritura no se hizo.
  expect(await prisma.proveedor.count({ where: { nombre } })).toBe(0);
});
