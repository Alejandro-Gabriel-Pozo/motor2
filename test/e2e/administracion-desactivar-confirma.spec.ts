import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Administración — «Desactivar» un rol o un usuario pide confirmación.
 *
 * Antes, un clic en «Desactivar» cortaba el acceso al instante y sin pausa. Ahora
 * el primer clic solo abre la confirmación en la misma fila; el cambio se aplica
 * con «Sí, desactivar» y no se aplica con «Cancelar». Activar sigue siendo directo.
 */
test("roles: «Desactivar» pide confirmación, «Cancelar» no cambia nada y «Sí, desactivar» sí", async ({ paginaAutenticada: page }) => {
  const rol = await prisma.rol.create({ data: { nombre: `e2e-rol-${Date.now()}` } });
  const fila = () => page.getByRole("row", { name: new RegExp(rol.nombre) });

  await page.goto("/administracion/roles");
  await fila().getByRole("button", { name: "Desactivar" }).click();

  // El primer clic solo muestra la confirmación: el rol sigue activo.
  await expect(fila().getByText(`¿Desactivar el rol "${rol.nombre}"?`)).toBeVisible();
  expect((await prisma.rol.findUniqueOrThrow({ where: { id: rol.id } })).activo).toBe(true);

  // «Cancelar» vuelve al botón original, sin cambios.
  await fila().getByRole("button", { name: "Cancelar" }).click();
  await expect(fila().getByRole("button", { name: "Desactivar" })).toBeVisible();
  expect((await prisma.rol.findUniqueOrThrow({ where: { id: rol.id } })).activo).toBe(true);

  // «Sí, desactivar» aplica el cambio.
  await fila().getByRole("button", { name: "Desactivar" }).click();
  await fila().getByRole("button", { name: "Sí, desactivar" }).click();
  await expect(fila().getByRole("button", { name: "Activar" })).toBeVisible();
  expect((await prisma.rol.findUniqueOrThrow({ where: { id: rol.id } })).activo).toBe(false);

  // Activar sigue siendo directo: un solo clic, sin confirmación.
  await fila().getByRole("button", { name: "Activar" }).click();
  await expect(fila().getByRole("button", { name: "Desactivar" })).toBeVisible();
  expect((await prisma.rol.findUniqueOrThrow({ where: { id: rol.id } })).activo).toBe(true);
});

test("usuarios: «Desactivar» pide confirmación, «Cancelar» no cambia nada y «Sí, desactivar» sí", async ({ paginaAutenticada: page, sucursalId }) => {
  const operador = await prisma.rol.findUniqueOrThrow({ where: { nombre: "operador" } });
  const email = `e2e-usuario-${Date.now()}@local.test`;
  const usuario = await prisma.user.create({ data: { email } });
  const membresia = await prisma.usuarioSucursal.create({ data: { usuarioId: usuario.id, sucursalId, rolId: operador.id, activo: true } });
  const fila = () => page.getByRole("row", { name: new RegExp(email) });

  await page.goto("/administracion/usuarios");
  await fila().getByRole("button", { name: "Desactivar" }).click();

  await expect(fila().getByText(`¿Desactivar a ${email}? Pierde el acceso a esta sucursal.`)).toBeVisible();
  expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresia.id } })).activo).toBe(true);

  await fila().getByRole("button", { name: "Cancelar" }).click();
  await expect(fila().getByRole("button", { name: "Desactivar" })).toBeVisible();
  expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresia.id } })).activo).toBe(true);

  await fila().getByRole("button", { name: "Desactivar" }).click();
  await fila().getByRole("button", { name: "Sí, desactivar" }).click();
  await expect(fila().getByRole("button", { name: "Activar" })).toBeVisible();
  expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresia.id } })).activo).toBe(false);

  await fila().getByRole("button", { name: "Activar" }).click();
  await expect(fila().getByRole("button", { name: "Desactivar" })).toBeVisible();
  expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresia.id } })).activo).toBe(true);
});
