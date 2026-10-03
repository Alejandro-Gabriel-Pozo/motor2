import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Receta propia por sucursal (ADR-009, R3/R4): desde el editor de recetas, la sucursal activa crea su receta propia a partir de la central,
 * ve el aviso cuando la central cambia (sin que se aplique nada) y vuelve a la central con confirmación, dejando la propia como historial.
 */
test("crear la receta propia, ver el aviso «la central cambió» y volver a la central", async ({ paginaAutenticada: page, sucursalId }) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const insumo = await prisma.insumo.create({ data: { nombre: `E2E Harina propia ${marca}` } });
  const harina = await prisma.producto.create({ data: { codigo: `E2E-RP-HARINA-${marca}`, nombre: `E2E Harina propia ${marca}`, tipo: "MP", unidadStockId: kg.id, insumoId: insumo.id } });
  const pizza = await prisma.producto.create({ data: { codigo: `E2E-RP-PIZZA-${marca}`, nombre: `E2E Pizza propia ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 5000 } });
  await prisma.disponibilidadProducto.createMany({ data: [harina.id, pizza.id].map((productoId) => ({ sucursalId, productoId, disponible: true })) });
  const central = await prisma.recetaVersion.create({
    data: { productoId: pizza.id, version: 1, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 0.3, unidadId: kg.id }] } },
  });

  await page.goto(`/catalogo/recetas/${pizza.id}`);
  await expect(page.getByRole("heading", { name: /Receta de esta sucursal/ })).toBeVisible();
  await expect(page.getByText(/Esta sucursal usa la receta central/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "editor con el bloque de receta propia sin habilitar").toEqual([]);

  await page.getByRole("button", { name: "Crear receta propia a partir de la central" }).click();
  await expect(page.getByText(/en lugar de la central/)).toBeVisible();
  const propia = await prisma.recetaVersion.findFirstOrThrow({ where: { productoId: pizza.id, sucursalId } });
  expect(propia).toMatchObject({ version: 1, basadaEnVersionId: central.id });
  expect((await prisma.recetaSucursal.findFirstOrThrow({ where: { productoId: pizza.id, sucursalId } })).habilitada).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations, "editor con la receta propia habilitada").toEqual([]);

  // La central cambia: se avisa, pero la propia no se toca.
  await prisma.recetaVersion.create({
    data: { productoId: pizza.id, version: 2, ingredientes: { create: [{ insumoProductoId: harina.id, cantidad: 0.9, unidadId: kg.id }] } },
  });
  await page.goto(`/catalogo/recetas/${pizza.id}`);
  await expect(page.getByText(/La receta central cambió/)).toBeVisible();
  expect(await prisma.recetaVersion.count({ where: { productoId: pizza.id, sucursalId } })).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations, "editor con el aviso de la central").toEqual([]);

  // Volver a la central exige la confirmación (el checkbox es `required`) y deja la propia como historial.
  await page.getByLabel(/deja de usar su receta propia/).check();
  await page.getByRole("button", { name: "Volver a la receta central" }).click();
  await expect(page.getByText(/Esta sucursal usa la receta central/)).toBeVisible();
  await expect(page.getByText(/quedaron en el historial/)).toBeVisible();
  expect((await prisma.recetaSucursal.findFirstOrThrow({ where: { productoId: pizza.id, sucursalId } })).habilitada).toBe(false);
  expect(await prisma.recetaVersion.count({ where: { productoId: pizza.id, sucursalId } })).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations, "editor tras volver a la central").toEqual([]);
});
