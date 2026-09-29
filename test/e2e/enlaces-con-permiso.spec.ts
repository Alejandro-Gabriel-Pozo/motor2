import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { crearMembresia } from "../setup/membresia";

/**
 * Los enlaces de una pantalla a otra con permisos distintos no se muestran a quien no puede abrir el destino (terminarían en
 * «no tenés permiso»): queda el texto, sin enlace. El caso: Proveedores → «Comparativa de precios», que tiene su propia acción
 * (`comparar_precios`, distinta de `proveedores`).
 */
test("Proveedores muestra el enlace a la comparativa solo a quien puede verla", async ({ browser, baseURL, sucursalId }) => {
  const rol = await prisma.rol.create({ data: { nombre: `e2e-enlaces-${Date.now()}` } });
  await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: "proveedores", puedeVer: true, puedeEditar: false } });
  const usuario = await prisma.user.create({ data: { email: `e2e-enlaces-${Date.now()}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: rol.id, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });

  const contexto = await browser.newContext();
  await contexto.addCookies([
    { name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await contexto.newPage();
  const enlace = page.locator('a[href="/catalogo/proveedores/comparativa"]');

  // Sin «Ver» de la comparativa: el texto se ve, sin enlace (y con la explicación al pasar el mouse).
  await page.goto("/catalogo/proveedores");
  await expect(page.getByRole("heading", { name: "Proveedores" })).toBeVisible();
  await expect(page.getByText("Comparativa de precios →")).toBeVisible();
  await expect(enlace).toHaveCount(0);
  await expect(page.locator('[data-sin-permiso]', { hasText: "Comparativa de precios" })).toHaveAttribute("title", /no tiene permiso/);

  // Con «Ver» de la comparativa: aparece el enlace y lleva a la pantalla.
  await prisma.permisoRol.create({ data: { rolId: rol.id, accionClave: "comparar_precios", puedeVer: true, puedeEditar: false } });
  await page.goto("/catalogo/proveedores");
  await expect(enlace).toHaveCount(1);
  await enlace.click();
  await page.waitForURL(/\/catalogo\/proveedores\/comparativa$/);
  await expect(page.getByText(/No tenés permiso para ver esta sección/)).toHaveCount(0);

  await contexto.close();
});

test("el admin ve el enlace a la comparativa", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/proveedores");
  await expect(page.locator('a[href="/catalogo/proveedores/comparativa"]')).toHaveCount(1);
});
