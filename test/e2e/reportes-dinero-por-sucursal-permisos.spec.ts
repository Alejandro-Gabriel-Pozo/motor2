import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Browser } from "@playwright/test";
import { prisma } from "../../src/lib/db";
import { crearMembresias } from "../setup/membresia";

/**
 * Las pantallas que juntan dinero de varias sucursales (/reportes/consolidado y /reportes/rendimiento-recetas/por-sucursal) comprobaban el
 * permiso (`reporte_consolidado` / `reporte_rendimiento_sucursal`) solo en la sucursal ACTIVA y después mostraban TODAS las de `ctx.membresias`: un usuario admin en Central y
 * operador (sin ese permiso) en otra veía igual el dinero de la otra. Ahora suman solo las sucursales donde su rol allí puede verlo.
 */
async function abrirConDosSucursales(browser: Browser, baseURL: string | undefined, marca: number) {
  const central = await prisma.sucursal.findFirstOrThrow({ where: { nombre: "Central" } });
  const otra = await prisma.sucursal.create({ data: { nombre: `E2E Sin Dinero ${marca}` } });
  const admin = await prisma.rol.findFirstOrThrow({ where: { nombre: "admin" } });
  const operador = await prisma.rol.findFirstOrThrow({ where: { nombre: "operador" } });
  const usuario = await prisma.user.create({ data: { email: `e2e-dinero-${marca}@local.test`, activoGlobal: true } });
  await crearMembresias([
    { usuarioId: usuario.id, sucursalId: central.id, rolId: admin.id, activo: true },
    { usuarioId: usuario.id, sucursalId: otra.id, rolId: operador.id, activo: true },
  ]);
  const sessionToken = randomUUID();
  await prisma.session.create({ data: { sessionToken, userId: usuario.id, expires: new Date(Date.now() + 1000 * 60 * 60) } });
  const contexto = await browser.newContext();
  await contexto.addCookies([{ name: "authjs.session-token", value: sessionToken, domain: new URL(baseURL ?? "http://localhost:3000").hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
  return {
    page: await contexto.newPage(),
    central,
    otra,
    limpiar: async () => {
      await contexto.close();
      await prisma.session.deleteMany({ where: { userId: usuario.id } });
      await prisma.usuarioSucursal.deleteMany({ where: { usuarioId: usuario.id } });
      await prisma.usuarioEmpresa.deleteMany({ where: { usuarioId: usuario.id } });
      await prisma.user.deleteMany({ where: { id: usuario.id } });
      await prisma.sucursal.deleteMany({ where: { id: otra.id } });
    },
  };
}

test("consolidado: no suma una sucursal donde el rol no puede ver el dinero", async ({ browser, baseURL }) => {
  const { page, otra, limpiar } = await abrirConDosSucursales(browser, baseURL, Date.now());
  try {
    await page.goto("/reportes/consolidado");
    await expect(page.getByRole("heading", { name: "Resumen consolidado" })).toBeVisible();
    await expect(page.getByText("no hay nada que consolidar todavía")).toBeVisible();
    await expect(page.getByRole("cell", { name: otra.nombre })).toHaveCount(0);
  } finally {
    await limpiar();
  }
});

test("rendimiento por sucursal: no muestra la columna de una sucursal donde el rol no puede ver el dinero", async ({ browser, baseURL }) => {
  const marca = Date.now();
  const { page, otra, limpiar } = await abrirConDosSucursales(browser, baseURL, marca);
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-DIN-MP-${marca}`, nombre: `E2E Din Salsa ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const pv = await prisma.producto.create({ data: { codigo: `E2E-DIN-PV-${marca}`, nombre: `E2E Din Pizza ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });
  try {
    await page.goto("/reportes/rendimiento-recetas/por-sucursal?todas=1");
    await expect(page.getByRole("heading", { name: "Rendimiento por sucursal" })).toBeVisible();
    // Con la fila presente la tabla tiene encabezados: la columna de la sucursal activa está, la de la otra no (no es una ausencia vacua).
    await expect(page.getByRole("row", { name: new RegExp(pv.nombre) })).toBeVisible();
    await expect(page.locator("th", { hasText: "Central" }).first()).toBeVisible();
    await expect(page.locator("th", { hasText: otra.nombre })).toHaveCount(0);
  } finally {
    await limpiar();
    await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
    await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id] } } });
  }
});
