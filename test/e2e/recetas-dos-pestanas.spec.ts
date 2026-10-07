import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * H7 (Pureza Fase 4): dos personas (o dos pestañas) abren el editor de la MISMA receta; una guarda un cambio; la otra, con su pantalla vieja, intenta guardar el suyo. Antes se aplicaba
 * igual y podía borrar el cambio de la primera; ahora se rechaza con un mensaje y la receta queda como la dejó la primera. Se siembra directo en la base, como los otros specs de recetas.
 */
test("una pestaña con la receta vieja no pisa el cambio de la otra: se avisa y no se guarda", async ({ paginaAutenticada: pestañaA, sucursalId }) => {
  const marca = Date.now();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-2P-MP-${marca}`, nombre: `E2E Harina Dos Pestañas ${marca}`, tipo: "MP", unidadStockId: unidad.id } });
  const pv = await prisma.producto.create({ data: { codigo: `E2E-2P-PV-${marca}`, nombre: `E2E Pizza Dos Pestañas ${marca}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 100 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: mp.id, disponible: true } });
  await prisma.recetaVersion.create({
    data: {
      productoId: pv.id,
      version: 1,
      ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 0.3, unidadId: unidad.id }] },
      pasos: { create: [{ orden: 1, instruccion: "Amasar" }, { orden: 2, instruccion: "Estirar" }, { orden: 3, instruccion: "Hornear" }] },
    },
  });

  // Las dos pestañas abren el editor en la versión 1.
  const pestañaB = await pestañaA.context().newPage();
  await pestañaA.goto(`/catalogo/recetas/${pv.id}`);
  await pestañaB.goto(`/catalogo/recetas/${pv.id}`);
  await expect(pestañaA.locator("ol > li")).toHaveCount(3);
  await expect(pestañaB.locator("ol > li")).toHaveCount(3);

  // La pestaña A baja el primer paso: guarda la versión 2.
  await pestañaA.locator("ol > li").nth(0).getByRole("button", { name: "Bajar" }).click();
  await expect(pestañaA.locator("ol > li").nth(0)).toContainText("Estirar");
  expect((await prisma.recetaVersion.findMany({ where: { productoId: pv.id } })).map((v) => v.version).sort()).toEqual([1, 2]);

  // La pestaña B, que todavía muestra la versión 1, intenta bajar el MISMO paso: se rechaza con el mensaje.
  await pestañaB.locator("ol > li").nth(0).getByRole("button", { name: "Bajar" }).click();
  await expect(pestañaB.getByText(/cambió mientras la editabas/)).toBeVisible();
  expect((await prisma.recetaVersion.findMany({ where: { productoId: pv.id } })).map((v) => v.version).sort(), "no se guardó una versión 3").toEqual([1, 2]);

  // Recargando, B ve la receta como la dejó A, y su cambio ahora sí entra.
  await pestañaB.reload();
  await expect(pestañaB.locator("ol > li").nth(0)).toContainText("Estirar");
  await pestañaB.locator("ol > li").nth(0).getByRole("button", { name: "Bajar" }).click();
  await expect(pestañaB.locator("ol > li").nth(0)).toContainText("Amasar");
  expect((await prisma.recetaVersion.findMany({ where: { productoId: pv.id } })).map((v) => v.version).sort()).toEqual([1, 2, 3]);
});
