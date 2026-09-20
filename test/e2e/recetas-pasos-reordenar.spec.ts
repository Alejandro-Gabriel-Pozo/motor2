import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Reordenar pasos de receta (botones Subir/Bajar): genera una versión
 * nueva y renumera, sin tocar el historial de versiones anteriores. Se
 * siembra directo en la base (PV + MP + una RecetaVersion con 3 pasos) para
 * no depender de otros specs.
 */
test("bajar el primer paso reordena la vigente y el historial conserva el orden original de la v1", async ({ paginaAutenticada: page }) => {
  const marca = Date.now();
  const unidad = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const mp = await prisma.producto.create({
    data: { codigo: `E2E-PASO-MP-${marca}`, nombre: `E2E Harina Pasos ${marca}`, tipo: "MP", unidadStockId: unidad.id },
  });
  const pv = await prisma.producto.create({
    data: { codigo: `E2E-PASO-PV-${marca}`, nombre: `E2E Pizza Pasos ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 100 },
  });
  await prisma.recetaVersion.create({
    data: {
      productoId: pv.id,
      version: 1,
      ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 0.3, unidadId: unidad.id }] },
      pasos: { create: [{ orden: 1, instruccion: "Amasar" }, { orden: 2, instruccion: "Estirar" }, { orden: 3, instruccion: "Hornear" }] },
    },
  });

  await page.goto(`/catalogo/recetas/${pv.id}`);
  const pasos = page.locator("ol > li");
  await expect(pasos).toHaveCount(3);
  await expect(pasos.nth(0)).toContainText("Amasar");
  await expect(pasos.nth(1)).toContainText("Estirar");
  await expect(pasos.nth(2)).toContainText("Hornear");

  await pasos.nth(0).getByRole("button", { name: "Bajar" }).click();

  await expect(pasos.nth(0)).toContainText("Estirar");
  await expect(pasos.nth(1)).toContainText("Amasar");
  await expect(pasos.nth(2)).toContainText("Hornear");

  const versiones = await prisma.recetaVersion.findMany({ where: { productoId: pv.id } });
  expect(versiones.map((v) => v.version).sort()).toEqual([1, 2]);

  await page.goto(`/catalogo/recetas/${pv.id}/historial`);
  const version1 = page.locator("h2", { hasText: "Versión 1" }).locator("..");
  await expect(version1).toContainText("Amasar");
  await expect(version1).toContainText("Estirar");
  await expect(version1).toContainText("Hornear");
});
