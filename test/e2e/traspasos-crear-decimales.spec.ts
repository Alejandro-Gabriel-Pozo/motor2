import { test, expect } from "./fixtures/auth";
import { prisma } from "../../src/lib/db";

/**
 * Task #32 (docs/pendientes-*.md): Traspasos usaba `redondearACantidadDeUnidad` (redondea en silencio) en vez de
 * `validarCantidad` (rechaza) — mismo criterio ya aplicado en Mesa/Mostrador/Compra. Circuito completo end-to-end contra las
 * pantallas reales de "Enviar" (PUSH, `/traspasos/enviar`) y "Solicitar" (PULL, `/traspasos/solicitar`): cargar una cantidad
 * con más decimales de los que admite la unidad de stock (kg, 2 decimales) muestra el error y no crea nada.
 */
async function sembrarProductoTransferible(sucursalId: string, otraSucursalId: string, marca: string) {
  const kg = await prisma.unidad.findUniqueOrThrow({ where: { nombre: "kg" } });
  const producto = await prisma.producto.create({
    data: { codigo: `E2E-TRD-${marca}`, nombre: `E2E Traspaso Decimal ${marca}`, tipo: "MP", unidadStockId: kg.id },
  });
  await prisma.disponibilidadProducto.createMany({
    data: [sucursalId, otraSucursalId].map((id) => ({ sucursalId: id, productoId: producto.id, disponible: true })),
  });
  return producto;
}

async function elegirProducto(page: import("@playwright/test").Page, nombre: string) {
  const combo = page.getByRole("combobox", { name: "Producto" });
  await combo.fill(nombre);
  await page.getByRole("option", { name: new RegExp(nombre) }).click();
}

async function limpiar(productoId: string, otraSucursalId: string) {
  await prisma.movimientoStock.deleteMany({ where: { productoId } });
  await prisma.traspasoSucursal.deleteMany({ where: { productoId } });
  await prisma.disponibilidadProducto.deleteMany({ where: { productoId } });
  await prisma.producto.deleteMany({ where: { id: productoId } });
  await prisma.sucursal.deleteMany({ where: { id: otraSucursalId } });
}

test("«Enviar» (PUSH) rechaza una cantidad con más decimales de los que admite la unidad y no crea nada", async ({
  paginaAutenticada: page,
  sucursalId,
  seccionId,
}) => {
  const marca = `${Date.now()}`;
  const otra = await prisma.sucursal.create({ data: { nombre: `E2E Traspaso Destino ${marca}` } });
  const producto = await sembrarProductoTransferible(sucursalId, otra.id, marca);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "e2e-admin@local.test" } });
  const operacion = await prisma.operacion.create({ data: { sucursalId, proceso: "COMPRA", fecha: new Date(), usuarioId: admin.id } });
  await prisma.movimientoStock.create({
    data: { operacionId: operacion.id, productoId: producto.id, seccionId, proceso: "COMPRA", cantidad: 10, detalle: "Stock inicial del test", precioTotal: 0, precioPorUnidadStock: 0 },
  });

  try {
    await page.goto("/traspasos/enviar");
    await page.getByRole("combobox", { name: "Sucursal a la que se lo mandás" }).selectOption({ label: otra.nombre });
    await elegirProducto(page, producto.nombre);
    await page.locator("label:has-text('Cantidad') input").first().fill("3,126");
    await page.getByRole("combobox", { name: /Sección propia de la que sale/ }).selectOption({ label: "Depósito E2E" });
    await page.getByRole("button", { name: "Enviar", exact: true }).click();

    await expect(page.getByText(/decimales/)).toBeVisible();
    expect(await prisma.traspasoSucursal.count({ where: { productoId: producto.id } })).toBe(0);
    expect(await prisma.movimientoStock.count({ where: { productoId: producto.id, proceso: "TRANSFERENCIA_SALIDA_SUCURSAL" } })).toBe(0);
  } finally {
    await limpiar(producto.id, otra.id);
  }
});

test("«Solicitar» (PULL) rechaza una cantidad con más decimales de los que admite la unidad y no crea nada", async ({
  paginaAutenticada: page,
  sucursalId,
}) => {
  const marca = `${Date.now()}-b`;
  const otra = await prisma.sucursal.create({ data: { nombre: `E2E Traspaso Origen ${marca}` } });
  const producto = await sembrarProductoTransferible(sucursalId, otra.id, marca);

  try {
    await page.goto("/traspasos/solicitar");
    await page.getByRole("combobox", { name: "Sucursal a la que se lo pedís" }).selectOption({ label: otra.nombre });
    await elegirProducto(page, producto.nombre);
    await page.locator("label:has-text('Cantidad') input").first().fill("3,126");
    await page.getByRole("combobox", { name: /Sección propia a la que tiene que entrar/ }).selectOption({ label: "Depósito E2E" });
    await page.getByRole("button", { name: "Solicitar", exact: true }).click();

    await expect(page.getByText(/decimales/)).toBeVisible();
    expect(await prisma.traspasoSucursal.count({ where: { productoId: producto.id } })).toBe(0);
  } finally {
    await limpiar(producto.id, otra.id);
  }
});
