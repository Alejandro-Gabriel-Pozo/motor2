import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { crearMembresias } from "../setup/membresia";

/**
 * Brecha detectada al planificar la consistencia del margen Real
 * (docs/pendientes-responsable-2026-09-20.md): hasta ahora ningún spec de
 * Playwright abría /reportes/consolidado, /reportes/promociones ni
 * /reportes/categorias — justo las tres pantallas que tocó ese trabajo.
 */
test("consolidado: con una sola sucursal explica que no hay nada que consolidar", async ({ paginaAutenticada: page }) => {
  await page.goto("/reportes/consolidado");
  await expect(page.getByRole("heading", { name: "Resumen consolidado" })).toBeVisible();
  await expect(page.getByText("no hay nada que consolidar todavía")).toBeVisible();
});

test("consolidado: con dos o más sucursales, arma la tabla y suma los totales", async ({ browser, baseURL }) => {
  const marca = Date.now();
  const central = await prisma.sucursal.findFirstOrThrow({ where: { nombre: "Central" } });
  const segunda = await prisma.sucursal.create({ data: { nombre: `E2E Sucursal Dos ${marca}` } });
  const rol = await prisma.rol.findFirstOrThrow({ where: { clave: "admin" } });
  const usuario = await prisma.user.create({ data: { email: `e2e-consolidado-${marca}@local.test`, activoGlobal: true } });
  await crearMembresias([
      { usuarioId: usuario.id, sucursalId: central.id, rolId: rol.id, activo: true },
      { usuarioId: usuario.id, sucursalId: segunda.id, rolId: rol.id, activo: true },
    ]);
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });

  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  const page = await contexto.newPage();

  await page.goto("/reportes/consolidado");
  await expect(page.getByRole("heading", { name: "Resumen consolidado" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Central" })).toBeVisible();
  await expect(page.getByRole("cell", { name: `E2E Sucursal Dos ${marca}` })).toBeVisible();
  await contexto.close();
});

test("categorías: la pantalla carga sin error y muestra el total facturado", async ({ paginaAutenticada: page }) => {
  await page.goto("/reportes/categorias");
  await expect(page.getByRole("heading", { name: "Ventas por categoría" })).toBeVisible();
});
