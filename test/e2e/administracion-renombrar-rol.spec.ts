import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Bloque G, G3 — renombrar un rol desde la pantalla de roles. Cambia la etiqueta, nunca la identidad: el rol de sistema renombrado sigue siendo
 * el administrador (la sesión que lo tiene no pierde acceso) y los nombres de fábrica quedan reservados.
 */

test("roles: «Renombrar» cambia el nombre de un rol creado a mano, y «Cancelar» no cambia nada", async ({ paginaAutenticada: page }) => {
  const marca = Date.now();
  const rol = await prisma.rol.create({ data: { nombre: `e2e-rol-${marca}` } });
  const fila = (nombre: string) => page.getByRole("row", { name: new RegExp(nombre) });

  await page.goto("/administracion/roles");
  await page.getByRole("button", { name: `Renombrar el rol ${rol.nombre}`, exact: true }).click();
  await page.getByRole("textbox", { name: `Nuevo nombre del rol ${rol.nombre}` }).fill("  Jefe   E2E ");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect((await prisma.rol.findUniqueOrThrow({ where: { id: rol.id } })).nombre).toBe(rol.nombre);

  await page.getByRole("button", { name: `Renombrar el rol ${rol.nombre}`, exact: true }).click();
  await page.getByRole("textbox", { name: `Nuevo nombre del rol ${rol.nombre}` }).fill(`  Jefe   E2E ${marca} `);
  await page.getByRole("button", { name: "Guardar", exact: true }).click();

  await expect(page.getByRole("status")).toContainText(`renombrado a "jefe e2e ${marca}"`);
  await expect(fila(`jefe e2e ${marca}`)).toBeVisible();
  expect((await prisma.rol.findUniqueOrThrow({ where: { id: rol.id } })).nombre).toBe(`jefe e2e ${marca}`);
});

test("roles: un nombre de fábrica reservado se rechaza y el rol queda como estaba", async ({ paginaAutenticada: page }) => {
  const rol = await prisma.rol.create({ data: { nombre: `e2e-rol-${Date.now()}` } });

  await page.goto("/administracion/roles");
  await page.getByRole("button", { name: `Renombrar el rol ${rol.nombre}`, exact: true }).click();
  await page.getByRole("textbox", { name: `Nuevo nombre del rol ${rol.nombre}` }).fill("Gerente");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();

  await expect(page.getByRole("status")).toContainText("está reservado");
  expect((await prisma.rol.findUniqueOrThrow({ where: { id: rol.id } })).nombre).toBe(rol.nombre);
});

test("roles: el rol de sistema se puede renombrar, conserva su clave, no ofrece «Desactivar» y la sesión sigue gobernando", async ({ paginaAutenticada: page }) => {
  const admin = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
  const nombreOriginal = admin.nombre;
  const nuevo = `jefatura-e2e-${Date.now()}`;

  try {
    await page.goto("/administracion/roles");
    const fila = (nombre: string) => page.getByRole("row", { name: new RegExp(nombre) });
    await expect(fila(nombreOriginal).first().getByRole("button", { name: "Desactivar", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: `Renombrar el rol ${nombreOriginal}`, exact: true }).click();
    await page.getByRole("textbox", { name: `Nuevo nombre del rol ${nombreOriginal}` }).fill(nuevo);
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("renombrado");

    const renombrado = await prisma.rol.findUniqueOrThrow({ where: { id: admin.id } });
    expect(renombrado.nombre).toBe(nuevo);
    expect(renombrado.clave).toBe("admin");

    // Sigue siendo el administrador: la pantalla (que exige permiso de ver «gestion_roles») y el botón «Renombrar» siguen a la vista.
    await page.reload();
    await expect(fila(nuevo)).toContainText("clave técnica «admin»");
    await expect(page.getByRole("button", { name: `Renombrar el rol ${nuevo}`, exact: true })).toBeVisible();
  } finally {
    await prisma.rol.update({ where: { id: admin.id }, data: { nombre: nombreOriginal } });
  }
});
