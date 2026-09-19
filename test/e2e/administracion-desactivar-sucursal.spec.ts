import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Administración — «Desactivar» una sucursal pide confirmación (misma regla que roles y usuarios,
 * ver administracion-desactivar-confirma.spec.ts). Desactivar una sucursal corta el acceso de todos sus
 * usuarios a la vez, así que un clic no alcanza; activar sigue siendo directo.
 *
 * Los botones se buscan con `exact: true` (por defecto Playwright compara por subcadena: «Activar» está
 * dentro de «Desactivar»).
 */
test("sucursales: «Desactivar» pide confirmación, «Cancelar» no cambia nada y «Sí, desactivar» sí", async ({ paginaAutenticada: page }) => {
  const sucursal = await prisma.sucursal.create({ data: { nombre: `E2E Sucursal ${Date.now()}` } });
  // La fila se encuentra por el campo de renombrar, que trae el nombre como valor.
  const fila = () => page.locator("tr", { has: page.locator(`input[value="${sucursal.nombre}"]`) });
  const boton = (nombre: string) => fila().getByRole("button", { name: nombre, exact: true });
  const activa = async () => (await prisma.sucursal.findUniqueOrThrow({ where: { id: sucursal.id } })).activo;

  await page.goto("/administracion/sucursales");
  await boton("Desactivar").click();

  await expect(fila().getByRole("alert")).toHaveText(`¿Desactivar la sucursal "${sucursal.nombre}"? Sus usuarios dejan de poder entrar a ella.`);
  expect(await activa()).toBe(true);

  await boton("Cancelar").click();
  await expect(boton("Desactivar")).toBeFocused();
  expect(await activa()).toBe(true);

  await boton("Desactivar").click();
  await boton("Sí, desactivar").click();
  // La columna «Activo» y el botón se actualizan solos (la fila se refresca al terminar).
  await expect(boton("Activar")).toBeVisible();
  await expect(fila().getByRole("cell", { name: "No", exact: true })).toBeVisible();
  await expect(fila().getByText(`Sucursal "${sucursal.nombre}" desactivada.`)).toBeVisible();
  expect(await activa()).toBe(false);

  // Activar sigue siendo directo.
  await boton("Activar").click();
  await expect(boton("Desactivar")).toBeVisible();
  await expect(fila().getByRole("cell", { name: "Sí", exact: true })).toBeVisible();
  expect(await activa()).toBe(true);
});
