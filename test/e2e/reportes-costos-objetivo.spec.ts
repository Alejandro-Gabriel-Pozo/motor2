import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";
import { usuarioConDosSucursales } from "./fixtures/dos-sucursales";

/**
 * Food cost objetivo (40 % sobre el precio de venta, sin packaging) en /reportes/costos: la columna «Precio para food cost 40%» y el estado
 * «Food cost alto» salen del mismo número (`FOOD_COST_OBJETIVO_PCT`). El objetivo es único para la empresa, pero se evalúa en cada sucursal con
 * SU costo (la última compra de esa sucursal), así que el mismo plato puede estar bien en una y alto en otra.
 */

async function sembrarPlatos(marca: number) {
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-OBJ-MP-${marca}`, nombre: `E2E Insumo Objetivo ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  // Con el insumo a $4000 el kg: «Justo» cuesta $4000 (40 % de $10.000) y «Pasado» $4100 (41 % de $10.000).
  const justo = await prisma.producto.create({ data: { codigo: `E2E-OBJ-J-${marca}`, nombre: `E2E Plato Justo ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 10000 } });
  const pasado = await prisma.producto.create({ data: { codigo: `E2E-OBJ-P-${marca}`, nombre: `E2E Plato Pasado ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 10000 } });
  await prisma.recetaVersion.create({ data: { productoId: justo.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });
  await prisma.recetaVersion.create({ data: { productoId: pasado.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1.025, unidadId: kg.id }] } } });
  return { mp, justo, pasado };
}

async function comprar(sucursalId: string, seccionId: string, productoId: string, precioPorUnidad: number) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: operacion.id, productoId, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: precioPorUnidad * 10, precioPorUnidadStock: precioPorUnidad },
  });
  return operacion.id;
}

async function limpiarPlatos(platos: Awaited<ReturnType<typeof sembrarPlatos>>, operaciones: string[]) {
  const ids = [platos.mp.id, platos.justo.id, platos.pasado.id];
  await prisma.movimientoStock.deleteMany({ where: { productoId: { in: ids } } });
  await prisma.operacion.deleteMany({ where: { id: { in: operaciones } } });
  await prisma.recetaVersion.deleteMany({ where: { productoId: { in: [platos.justo.id, platos.pasado.id] } } });
  await prisma.producto.deleteMany({ where: { id: { in: ids } } });
}

test("justo en el 40 % es OK y un punto más es «Food cost alto»; la columna muestra el precio que deja el food cost en 40 %", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = Date.now();
  const platos = await sembrarPlatos(marca);
  const operacion = await comprar(sucursalId, seccionId, platos.mp.id, 4000);
  try {
    await page.goto("/reportes/costos");
    await expect(page.getByRole("heading", { name: "Costos y márgenes" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Precio para food cost 40%/ })).toBeVisible();

    const filaJusto = page.locator("tr", { hasText: platos.justo.nombre });
    await expect(filaJusto).toContainText("40%");
    await expect(filaJusto).toContainText("$10.000"); // precio para food cost 40 %: $4000 ÷ 0,40
    await expect(filaJusto.getByText("Food cost alto")).toHaveCount(0);

    const filaPasado = page.locator("tr", { hasText: platos.pasado.nombre });
    await expect(filaPasado).toContainText("41%");
    await expect(filaPasado).toContainText("$10.250"); // $4100 ÷ 0,40
    await expect(filaPasado.getByText("Food cost alto")).toBeVisible();
  } finally {
    await limpiarPlatos(platos, [operacion]);
  }
});

test("el objetivo es el mismo pero se evalúa con el costo de cada sucursal: el mismo plato está bien en una y alto en la otra", async ({ browser, baseURL, sucursalId, seccionId }) => {
  const { page, segunda, limpiar } = await usuarioConDosSucursales(browser, baseURL, sucursalId, "admin", "admin");
  const marca = Date.now();
  const platos = await sembrarPlatos(marca);
  const seccionSegunda = await prisma.seccion.create({ data: { sucursalId: segunda.id, nombre: `E2E Sección Objetivo ${marca}` } });
  const operaciones = [await comprar(sucursalId, seccionId, platos.mp.id, 4000), await comprar(segunda.id, seccionSegunda.id, platos.mp.id, 5000)];
  try {
    await page.goto("/reportes/costos");
    const filaCentral = page.locator("tr", { hasText: platos.justo.nombre });
    await expect(filaCentral).toContainText("40%");
    await expect(filaCentral).toContainText("$10.000");
    await expect(filaCentral.getByText("Food cost alto")).toHaveCount(0);

    await page.getByLabel("Sucursal activa").selectOption(segunda.id);
    await page.waitForURL((url) => url.pathname === "/reportes/costos");
    await expect(page.getByLabel("Sucursal activa")).toHaveValue(segunda.id);
    const filaSegunda = page.locator("tr", { hasText: platos.justo.nombre });
    await expect(filaSegunda).toContainText("50%");
    await expect(filaSegunda).toContainText("$12.500"); // $5000 ÷ 0,40
    await expect(filaSegunda.getByText("Food cost alto")).toBeVisible();
  } finally {
    await prisma.movimientoStock.deleteMany({ where: { seccionId: seccionSegunda.id } });
    await limpiarPlatos(platos, operaciones);
    await prisma.seccion.deleteMany({ where: { id: seccionSegunda.id } });
    await limpiar();
  }
});
