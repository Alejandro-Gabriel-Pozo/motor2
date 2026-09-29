import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { crearMembresia } from "../setup/membresia";

/**
 * Administración — «Desactivar» un rol o un usuario pide confirmación.
 *
 * Antes, un clic en «Desactivar» cortaba el acceso al instante y sin pausa. Ahora
 * el primer clic solo abre la confirmación en la misma fila; el cambio se aplica
 * con «Sí, desactivar» y no se aplica con «Cancelar». Activar sigue siendo directo.
 *
 * Los botones se buscan con `exact: true`: por defecto Playwright compara el nombre como subcadena sin
 * distinguir mayúsculas, y «Activar» está dentro de «Desactivar» (y «Desactivar» dentro de «Sí, desactivar»).
 * Sin `exact`, entre el fin del pedido al servidor y el refresco de la fila, la espera de «Activar» la
 * cumplía el «Desactivar» viejo todavía en pantalla y el test seguía antes de tiempo (falla intermitente).
 */
test("roles: «Desactivar» pide confirmación, «Cancelar» no cambia nada y «Sí, desactivar» sí", async ({ paginaAutenticada: page }) => {
  const rol = await prisma.rol.create({ data: { nombre: `e2e-rol-${Date.now()}` } });
  const fila = () => page.getByRole("row", { name: new RegExp(rol.nombre) });

  await page.goto("/administracion/roles");
  await fila().getByRole("button", { name: "Desactivar", exact: true }).click();

  // El primer clic solo muestra la confirmación (anunciada como alerta, con la consecuencia): el rol sigue activo.
  await expect(fila().getByRole("alert")).toHaveText(`¿Desactivar el rol "${rol.nombre}"? Deja de poder asignarse a usuarios nuevos.`);
  expect((await prisma.rol.findUniqueOrThrow({ where: { id: rol.id } })).activo).toBe(true);

  // El foco arranca en «Cancelar» (lo seguro por defecto) y «Sí, desactivar» lee el aviso como descripción.
  await expect(fila().getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
  await expect(fila().getByRole("button", { name: "Sí, desactivar", exact: true })).toHaveAccessibleDescription(/Deja de poder asignarse/);
  await expect(fila().getByRole("button", { name: "Cancelar", exact: true })).toHaveAccessibleDescription(/Deja de poder asignarse/);

  // «Cancelar» vuelve al botón original, con el foco, sin cambios.
  await fila().getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(fila().getByRole("button", { name: "Desactivar", exact: true })).toBeFocused();
  expect((await prisma.rol.findUniqueOrThrow({ where: { id: rol.id } })).activo).toBe(true);

  // Escape también cancela, con el foco de vuelta en «Desactivar».
  await fila().getByRole("button", { name: "Desactivar", exact: true }).click();
  await expect(fila().getByRole("button", { name: "Cancelar", exact: true })).toBeFocused(); // el foco tiene que estar en la fila antes de mandar la tecla
  await page.keyboard.press("Escape");
  await expect(fila().getByRole("button", { name: "Desactivar", exact: true })).toBeFocused();
  expect((await prisma.rol.findUniqueOrThrow({ where: { id: rol.id } })).activo).toBe(true);

  // «Sí, desactivar» aplica el cambio.
  await fila().getByRole("button", { name: "Desactivar", exact: true }).click();
  await fila().getByRole("button", { name: "Sí, desactivar", exact: true }).click();
  await expect(fila().getByRole("button", { name: "Activar", exact: true })).toBeVisible();
  expect((await prisma.rol.findUniqueOrThrow({ where: { id: rol.id } })).activo).toBe(false);

  // Activar sigue siendo directo: un solo clic, sin confirmación.
  await fila().getByRole("button", { name: "Activar", exact: true }).click();
  await expect(fila().getByRole("button", { name: "Desactivar", exact: true })).toBeVisible();
  expect((await prisma.rol.findUniqueOrThrow({ where: { id: rol.id } })).activo).toBe(true);
});

test("usuarios: «Desactivar» pide confirmación, «Cancelar» no cambia nada y «Sí, desactivar» sí", async ({ paginaAutenticada: page, sucursalId }) => {
  const operador = await prisma.rol.findFirstOrThrow({ where: { nombre: "operador" } });
  const email = `e2e-usuario-${Date.now()}@local.test`;
  const usuario = await prisma.user.create({ data: { email } });
  const membresia = await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: operador.id, activo: true });
  const fila = () => page.getByRole("row", { name: new RegExp(email) });

  await page.goto("/administracion/usuarios");
  await fila().getByRole("button", { name: "Desactivar", exact: true }).click();

  await expect(fila().getByRole("alert")).toHaveText(`¿Desactivar a ${email}? Pierde el acceso a esta sucursal.`);
  expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresia.id } })).activo).toBe(true);

  await fila().getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(fila().getByRole("button", { name: "Desactivar", exact: true })).toBeVisible();
  expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresia.id } })).activo).toBe(true);

  await fila().getByRole("button", { name: "Desactivar", exact: true }).click();
  await fila().getByRole("button", { name: "Sí, desactivar", exact: true }).click();
  await expect(fila().getByRole("button", { name: "Activar", exact: true })).toBeVisible();
  expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresia.id } })).activo).toBe(false);

  await fila().getByRole("button", { name: "Activar", exact: true }).click();
  await expect(fila().getByRole("button", { name: "Desactivar", exact: true })).toBeVisible();
  expect((await prisma.usuarioSucursal.findUniqueOrThrow({ where: { id: membresia.id } })).activo).toBe(true);
});
