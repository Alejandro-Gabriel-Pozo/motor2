import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { crearMembresia } from "../setup/membresia";
import { ajustarCeldasDelAdmin } from "./fixtures/admin-con-filas";

/**
 * Los enlaces de una pantalla a otra con permisos distintos no se muestran a quien no puede abrir el destino (terminarían en
 * «no tenés permiso»): queda el texto, sin enlace. El caso: Proveedores → «Comparativa de precios», que tiene su propia acción
 * (`comparar_precios`, distinta de `proveedores`).
 */
test("Proveedores muestra el enlace a la comparativa solo a quien puede verla", async ({ browser, baseURL, sucursalId }) => {
  // «proveedores» y «comparar_precios» son de piso administrador: el caso se arma sobre el rol «admin» (se restaura al final).
  const admin = await ajustarCeldasDelAdmin({ proveedores: { puedeVer: true, puedeEditar: false }, comparar_precios: null });
  const rol = { id: admin.rolId };
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
  try {
    // Sin «Ver» de la comparativa: el texto se ve, sin enlace (y con la explicación al pasar el mouse).
    await page.goto("/catalogo/proveedores");
    await expect(page.getByRole("heading", { name: "Proveedores" })).toBeVisible();
    await expect(page.getByText("Comparativa de precios →")).toBeVisible();
    await expect(enlace).toHaveCount(0);
    await expect(page.locator('[data-sin-permiso]', { hasText: "Comparativa de precios" })).toHaveAttribute("title", /no tiene permiso/);

    // Con «Ver» de la comparativa: aparece el enlace y lleva a la pantalla.
    await admin.cambiar({ comparar_precios: { puedeVer: true, puedeEditar: false } });
    await page.goto("/catalogo/proveedores");
    await expect(enlace).toHaveCount(1);
    await enlace.click();
    await page.waitForURL(/\/catalogo\/proveedores\/comparativa$/);
    await expect(page.getByText(/No tenés permiso para ver esta sección/)).toHaveCount(0);
  } finally {
    await contexto.close();
    await admin.restaurar();
    await prisma.session.deleteMany({ where: { userId: usuario.id } });
    await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.usuarioEmpresa.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.user.deleteMany({ where: { id: usuario.id } });
  }
});

test("el admin ve el enlace a la comparativa", async ({ paginaAutenticada: page }) => {
  await page.goto("/catalogo/proveedores");
  await expect(page.locator('a[href="/catalogo/proveedores/comparativa"]')).toHaveCount(1);
});

test("Proveedores muestra «+ Nuevo proveedor» solo a quien puede darlos de alta (proveedor_alta con Editar)", async ({ browser, baseURL, sucursalId }) => {
  // El alta exige `proveedor_alta` con Editar; la lista solo pedía Ver de «proveedores» y mostraba el botón a quien terminaba en «no tenés permiso».
  const admin = await ajustarCeldasDelAdmin({ proveedores: { puedeVer: true, puedeEditar: false }, proveedor_alta: { puedeVer: true, puedeEditar: false } });
  const usuario = await prisma.user.create({ data: { email: `e2e-prov-alta-${Date.now()}@local.test`, activoGlobal: true } });
  await crearMembresia({ usuarioId: usuario.id, sucursalId, rolId: admin.rolId, activo: true });
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });

  const contexto = await browser.newContext();
  await contexto.addCookies([
    { name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" },
  ]);
  const page = await contexto.newPage();
  const botonAlta = page.locator('a[href="/catalogo/proveedores/nuevo"]');
  try {
    await page.goto("/catalogo/proveedores");
    await expect(page.getByRole("heading", { name: "Proveedores" })).toBeVisible();
    await expect(botonAlta, "«+ Nuevo proveedor» no tenía que mostrarse sin permiso de alta").toHaveCount(0);

    // Contraespejo: con Editar del alta aparece y lleva al formulario (impide «arreglarlo» escondiéndolo para todos).
    await admin.cambiar({ proveedor_alta: { puedeVer: true, puedeEditar: true } });
    await page.goto("/catalogo/proveedores");
    await expect(botonAlta).toHaveCount(1);
    await botonAlta.click();
    await page.waitForURL(/\/catalogo\/proveedores\/nuevo$/);
    await expect(page.getByText(/No tenés permiso/)).toHaveCount(0);
  } finally {
    await contexto.close();
    await admin.restaurar();
    await prisma.session.deleteMany({ where: { userId: usuario.id } });
    await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.usuarioEmpresa.deleteMany({ where: { usuarioId: usuario.id } });
    await prisma.user.deleteMany({ where: { id: usuario.id } });
  }
});
