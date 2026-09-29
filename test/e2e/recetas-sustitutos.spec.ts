import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Sustitución de insumos por línea de receta (docs/plan-sustitucion-insumos-receta-2026-09-26.md): declarar un sustituto desde el
 * editor, que sobreviva a una edición no relacionada (paso 6, ida y vuelta), que se vea en el historial (paso 10) y que una venta
 * que lo usó de verdad quede marcada en Trazabilidad (paso 9).
 */
test("declarar un sustituto en el editor sobrevive a editar un paso, se ve en el historial y en Trazabilidad tras una venta real", async ({
  paginaAutenticada: page,
  sucursalId,
}) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const insumoBife = await prisma.insumo.create({ data: { nombre: `E2E Bife de chorizo ${marca}` } });
  const insumoOjo = await prisma.insumo.create({ data: { nombre: `E2E Ojo de bife ${marca}` } });
  const bife = await prisma.producto.create({
    data: { codigo: `E2E-SUST-BIFE-${marca}`, nombre: `E2E Bife de chorizo ${marca}`, tipo: "MP", unidadStockId: kg.id, insumoId: insumoBife.id },
  });
  const ojo = await prisma.producto.create({
    data: { codigo: `E2E-SUST-OJO-${marca}`, nombre: `E2E Ojo de bife ${marca}`, tipo: "MP", unidadStockId: kg.id, insumoId: insumoOjo.id },
  });
  const milanesa = await prisma.producto.create({
    data: { codigo: `E2E-SUST-MILA-${marca}`, nombre: `E2E Milanesa ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 5000 },
  });
  await prisma.disponibilidadProducto.createMany({
    data: [bife.id, ojo.id, milanesa.id].map((productoId) => ({ sucursalId, productoId, disponible: true })),
  });
  await prisma.recetaVersion.create({
    data: { productoId: milanesa.id, version: 1, ingredientes: { create: [{ insumoProductoId: bife.id, cantidad: 0.3, unidadId: kg.id }] } },
  });

  // Declarar el sustituto desde el editor.
  await page.goto(`/catalogo/recetas/${milanesa.id}?editar=${bife.id}`);
  expect((await new AxeBuilder({ page }).analyze()).violations, "editor en modo Editar, con el fieldset de sustitutos").toEqual([]);
  await page.getByLabel("Sustituto 1").selectOption({ label: ojo.nombre });
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText(`Si no hay stock, se usa: ${ojo.nombre}`)).toBeVisible();

  // Editar un paso (algo que no toca el ingrediente sustituido) no debe perder el sustituto — la ida y vuelta del paso 6.
  await page.getByRole("button", { name: "Agregar paso" }).click();
  await page.getByPlaceholder("Instrucción").fill("Freír");
  await page.getByRole("button", { name: "Agregar paso" }).click();
  await expect(page.getByText("Freír")).toBeVisible();
  await expect(page.getByText(`Si no hay stock, se usa: ${ojo.nombre}`)).toBeVisible();

  // El historial de versiones lo muestra en cada versión donde estuvo declarado — v1 (donde se declaró) y v2 (el paso nuevo lo arrastró).
  await page.goto(`/catalogo/recetas/${milanesa.id}/historial`);
  await expect(page.getByText(`Sustitutos: ${ojo.nombre}`)).toHaveCount(2);
  const version2 = page.locator("h2", { hasText: "Versión 2" }).locator("..");
  await expect(version2.getByText(`Sustitutos: ${ojo.nombre}`)).toBeVisible();

  // Una venta real que se queda sin Bife usa el Ojo — sin stock de Bife, con stock de Ojo.
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const compra = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
  const seccion = await prisma.seccion.findFirstOrThrow({ where: { sucursalId } });
  await prisma.movimientoStock.create({
    data: { operacionId: compra.id, productoId: ojo.id, seccionId: seccion.id, proceso: "COMPRA", cantidad: 1, detalle: "Compra", precioTotal: 0, precioPorUnidadStock: 0 },
  });
  const mesa = await prisma.mesa.create({ data: { sucursalId, numero: 991 } });
  await prisma.cuenta.create({
    data: { mesaId: mesa.id, abiertaPorId: admin.id, items: { create: [{ productoId: milanesa.id, cantidad: 1, precioUnitario: 5000, numeroEnvio: 1, creadoPorId: admin.id }] } },
  });
  await page.goto(`/mesas/${mesa.id}`);
  await page.getByRole("button", { name: "Cerrar cuenta" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar y registrar la venta" }).click();
  await expect(page.locator('[role="status"][aria-live="polite"]')).toContainText("cerrada");

  const venta = await prisma.operacion.findFirstOrThrow({ where: { proceso: "VENTA", sucursalId, movimientos: { some: { productoId: ojo.id } } } });
  await page.goto(`/reportes/trazabilidad?idOperacion=${venta.id}`);
  await expect(page.getByText(`Sustituto de «${bife.nombre}»`)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations, "Trazabilidad con la etiqueta de sustituto").toEqual([]);
});
