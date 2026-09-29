import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Task #32 (docs/pendientes-*.md): Reclasificación NO tenía ningún chequeo de decimales en los montos de destino — ni
 * siquiera redondeo — antes de sumarlos al Kardex. Ahora se RECHAZA un destino con más decimales de los que admite la unidad
 * de stock (kg, 2 decimales), mismo criterio que Traspasos/Conteo Físico/Compra. Circuito completo end-to-end contra la
 * pantalla real `/stock/reclasificar`.
 */
test("rechaza un destino con más decimales de los que admite la unidad y no toca el stock", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const marca = `${Date.now()}`;
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const destino = await prisma.seccion.create({ data: { sucursalId, nombre: `E2E Reclasif Destino ${marca}` } });
  const producto = await prisma.producto.create({
    data: { codigo: `E2E-RC-${marca}`, nombre: `E2E Reclasif ${marca}`, tipo: "MP", unidadStockId: kg.id },
  });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: operacion.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Stock inicial del test", precioTotal: 0, precioPorUnidadStock: 0 },
  });

  try {
    await page.goto("/stock/reclasificar");
    const comboProducto = page.getByRole("combobox", { name: "Producto" });
    await comboProducto.fill(producto.nombre);
    await page.getByRole("option", { name: new RegExp(producto.nombre) }).click();
    await page.getByRole("combobox", { name: "Sección origen" }).selectOption({ label: "Depósito E2E" });
    await page.getByRole("combobox", { name: "Sección", exact: true }).selectOption({ label: destino.nombre });
    await page.locator("label:has-text('Cantidad') input").first().fill("9,996");
    await page.getByRole("button", { name: "Reclasificar", exact: true }).click();

    await expect(page.getByText(/decimales/)).toBeVisible();
    expect(await prisma.movimientoStock.count({ where: { productoId: producto.id, proceso: "RECLASIFICACION" } })).toBe(0);
    expect(await prisma.movimientoStock.count({ where: { productoId: producto.id } })).toBe(1); // solo la compra inicial, nada más
  } finally {
    await prisma.movimientoStock.deleteMany({ where: { productoId: producto.id } });
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
    await prisma.seccion.deleteMany({ where: { id: destino.id } });
  }
});
