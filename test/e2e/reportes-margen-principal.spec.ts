import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * §2 (docs/planes-demo-y-claridad-reportes-2026-09-21.md): la tarjeta de margen de /reportes/periodo muestra como cifra
 * PRINCIPAL el margen Real ("Ganancia de lo vendido" — costo del momento de cada venta), no el nominal ("Si repusieras hoy" —
 * costo de reposición de HOY, plegado en el `<details>`). Este test verifica que la presentación no mezcla los dos: siembra un
 * caso donde valen números BIEN distintos (el insumo se encareció mucho después de la venta) y confirma que cada cifra aparece
 * donde corresponde, no al revés.
 *
 * Ventana propia (mayo de 2024, que ningún otro spec toca) para no mezclarse con compras/ventas de otros specs. La compra que
 * sube el costo "de hoy" es de HOY (fecha real, fuera de la ventana): el margen Real (congelado a la venta) y "Costo de lo
 * vendido" no la ven; el nominal («de hoy») sí, sin depender de la ventana elegida — mismo criterio que documenta periodo.ts.
 */
test("«Ganancia de lo vendido» muestra el margen Real (congelado), no el nominal (de hoy) — y el nominal plegado es el que sí sube con el costo de reposición actual", async ({
  paginaAutenticada: page,
  sucursalId,
  seccionId,
}) => {
  const marca = Date.now();
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const mp = await prisma.producto.create({ data: { codigo: `E2E-MP-${marca}`, nombre: `E2E Insumo Margen ${marca}`, tipo: "MP", unidadStockId: kg.id } });
  const pv = await prisma.producto.create({ data: { codigo: `E2E-PV-${marca}`, nombre: `E2E Plato Margen ${marca}`, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
  await prisma.recetaVersion.create({ data: { productoId: pv.id, version: 1, ingredientes: { create: [{ insumoProductoId: mp.id, cantidad: 1, unidadId: kg.id }] } } });

  const operaciones: string[] = [];
  // Compra e insumo a $5/kg, en la ventana: costo congelado de la venta.
  const compraVieja = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date("2024-05-01T12:00:00Z"), usuarioId: admin.id } });
  operaciones.push(compraVieja.id);
  await prisma.movimientoStock.create({
    data: { operacionId: compraVieja.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Compra", precioTotal: 50, precioPorUnidadStock: 5 },
  });
  // Venta CON costo congelado explícito ($5 × 1kg = $5) — no depende de reconstrucción, aísla lo que este test quiere medir.
  const venta = await prisma.operacion.create({ data: { sucursalId, proceso: "VENTA", fecha: new Date("2024-05-02T12:00:00Z"), usuarioId: admin.id } });
  operaciones.push(venta.id);
  await prisma.movimientoStock.create({
    data: { operacionId: venta.id, productoId: pv.id, seccionId, proceso: "VENTA", cantidad: -1, detalle: "Venta", precioTotal: 100, precioPorUnidadStock: 100, costoUnitarioVenta: 5 },
  });
  // Compra de HOY a $50/kg: sube el costo de REPOSICIÓN actual del insumo — mueve el margen nominal, no el Real (ya congelado) ni el costo de lo vendido (fuera de la ventana).
  const compraHoy = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
  operaciones.push(compraHoy.id);
  await prisma.movimientoStock.create({
    data: { operacionId: compraHoy.id, productoId: mp.id, seccionId, proceso: "COMPRA", cantidad: 1, detalle: "Compra", precioTotal: 50, precioPorUnidadStock: 50 },
  });

  try {
    await page.goto("/reportes/periodo?desde=2024-05-01&hasta=2024-05-03");
    await expect(page.getByRole("heading", { name: "Reporte por período" })).toBeVisible();

    // La cifra principal es el Real: $95 (100 de venta − 5 de costo congelado), 95%. NO el nominal ($50, 50%).
    const tarjetaMargen = page.getByText("Ganancia de lo vendido").locator("..");
    await expect(tarjetaMargen).toContainText("$95");
    await expect(tarjetaMargen).toContainText("95%");
    await expect(tarjetaMargen).not.toContainText("$50 (50%)");

    // Costo de lo vendido: $5 (5%) — coincide con la identidad costoDeLoVendidoTotal ≈ ingresoConCostoReal − margenRealTotal (100 − 95 = 5).
    const consumo = page.locator("[data-costo-de-lo-vendido]");
    await expect(consumo).toContainText("$5 (5%)");
    await expect(consumo).not.toContainText("reconstruido"); // costo congelado explícito, no reconstruido

    // Plegado por defecto: el nominal ($50, más alto por el costo de reposición de HOY) no se ve todavía.
    const detalle = page.locator("details").filter({ hasText: "Otras formas de ver el margen" });
    await expect(detalle).toHaveJSProperty("open", false);
    await expect(detalle.getByText("Si repusieras hoy")).not.toBeVisible();

    await detalle.locator("summary").click();
    await expect(detalle).toHaveJSProperty("open", true);
    await expect(detalle.getByText("Si repusieras hoy")).toBeVisible();
    await expect(detalle).toContainText("$50");
    await expect(detalle).toContainText("(50%)");
  } finally {
    await prisma.movimientoStock.deleteMany({ where: { productoId: { in: [mp.id, pv.id] } } });
    await prisma.operacion.deleteMany({ where: { id: { in: operaciones } } });
    await prisma.recetaVersion.deleteMany({ where: { productoId: pv.id } });
    await prisma.producto.deleteMany({ where: { id: { in: [pv.id, mp.id] } } });
  }
});
