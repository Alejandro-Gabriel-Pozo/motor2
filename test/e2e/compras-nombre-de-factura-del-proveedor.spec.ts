import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

async function elegirSelectPorOpcion(page: Page, textoOpcion: string) {
  for (const select of await page.locator("select").all()) {
    if ((await select.locator("option").allTextContents()).includes(textoOpcion)) {
      await select.selectOption({ label: textoOpcion });
      return;
    }
  }
  throw new Error(`Ningún <select> tiene una opción "${textoOpcion}"`);
}

/** Si CAPTURAS_DIR está definida, guarda una captura de la pantalla (para mostrarle al dueño el recorrido). */
async function capturar(page: Page, nombre: string) {
  if (process.env.CAPTURAS_DIR) await page.screenshot({ path: `${process.env.CAPTURAS_DIR}/${nombre}.png`, fullPage: true });
}

/**
 * Recorrido del dueño (2026-10-27): «creo Ojo de bife como materia prima y le pongo a cada proveedor el nombre que le pone en su factura».
 * Un solo producto bajo un Insumo y dos proveedores que lo llaman distinto: la primera compra a cada uno guarda su nombre de factura
 * («Código/nombre del proveedor»); la siguiente vez que se elige a ese proveedor la fila viene sola, con ese nombre, y el stock del
 * producto es uno solo (la suma de las dos compras). La ficha de cada proveedor muestra «Cómo lo llama».
 */
test("un producto, dos proveedores con su nombre de factura: se guarda al comprar, se precarga después y el stock es uno solo", async ({ paginaAutenticada: page, sucursalId, seccionId }) => {
  const ahora = Date.now();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const nombreProducto = `E2E Ojo de bife ${ahora}`;
  const insumo = await prisma.insumo.create({ data: { nombre: nombreProducto } });
  const producto = await prisma.producto.create({
    data: { codigo: `E2E-OB-${ahora}`, nombre: nombreProducto, tipo: "MP", unidadStockId: unidad.id, unidadCompraId: unidad.id, insumoId: insumo.id },
  });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  const proveedorA = await prisma.proveedor.create({ data: { codigo: `PRV_OB_A_${ahora}`, nombre: `E2E Frigorífico Río ${ahora}` } });
  const proveedorB = await prisma.proveedor.create({ data: { codigo: `PRV_OB_B_${ahora}`, nombre: `E2E Carnicería Sur ${ahora}` } });
  const seccion = await prisma.seccion.findUniqueOrThrow({ where: { id: seccionId } });
  const nombreEnLaFacturaA = "Ojo de bife rioplatense";
  const nombreEnLaFacturaB = "Ojo de bife a secas";
  const referencia = page.locator("label:has-text('Código/nombre del proveedor') input").first();
  const productoDeLaFila = page.locator('input[placeholder="Código o nombre…"]').first();

  async function primeraCompra(proveedorNombre: string, nombreEnLaFactura: string, kilos: string, precioTotal: string) {
    await page.goto("/movimientos/compra");
    await elegirSelectPorOpcion(page, seccion.nombre);
    await elegirSelectPorOpcion(page, proveedorNombre);
    await expect(page.getByText(/Todavía no le compraste nada a este proveedor/)).toBeVisible();
    await productoDeLaFila.fill(nombreProducto);
    await page.getByRole("option", { name: new RegExp(nombreProducto) }).click();
    await referencia.fill(nombreEnLaFactura);
    await page.locator("label:has-text('Cantidad') input").first().fill(kilos);
    await page.locator("label:has-text('Precio total') input").first().fill(precioTotal);
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/Se guardaron \d+ movimiento/)).toBeVisible();
  }

  // 1) La primera compra a cada proveedor guarda el nombre de SU factura.
  await primeraCompra(proveedorA.nombre, nombreEnLaFacturaA, "10", "1000");
  await primeraCompra(proveedorB.nombre, nombreEnLaFacturaB, "5", "700");

  const vinculos = await prisma.proveedorPorProducto.findMany({ where: { productoId: producto.id }, orderBy: { referenciaProveedor: "asc" } });
  expect(vinculos.map((v) => [v.proveedorId, v.referenciaProveedor]).sort()).toEqual(
    [
      [proveedorA.id, nombreEnLaFacturaA],
      [proveedorB.id, nombreEnLaFacturaB],
    ].sort()
  );

  // 2) La vez siguiente, al elegir al proveedor, la fila viene sola con SU nombre de factura y solo falta la cantidad.
  await page.goto("/movimientos/compra");
  await elegirSelectPorOpcion(page, seccion.nombre);
  await elegirSelectPorOpcion(page, proveedorA.nombre);
  await expect(page.getByText(/1 producto\(s\) que ya le comprás/)).toBeVisible();
  await expect(productoDeLaFila).toHaveValue(new RegExp(nombreProducto));
  await expect(referencia).toHaveValue(nombreEnLaFacturaA);
  await capturar(page, "1-proveedor-a-fila-precargada");

  await elegirSelectPorOpcion(page, proveedorB.nombre);
  await expect(page.getByText(/1 producto\(s\) que ya le comprás/)).toBeVisible();
  await expect(productoDeLaFila).toHaveValue(new RegExp(nombreProducto));
  await expect(referencia).toHaveValue(nombreEnLaFacturaB);
  await capturar(page, "2-proveedor-b-fila-precargada");

  // 3) El stock es UN solo producto: la suma de las dos compras, sin importar el proveedor ni el nombre de la factura.
  const movimientos = await prisma.movimientoStock.findMany({ where: { productoId: producto.id } });
  expect(movimientos).toHaveLength(2);
  expect(movimientos.reduce((suma, m) => suma + Number(m.cantidad), 0)).toBe(15);
  expect(movimientos.reduce((suma, m) => suma + Number(m.precioTotal), 0)).toBe(1700);

  // 4) La ficha de cada proveedor muestra «Cómo lo llama».
  await page.goto(`/catalogo/proveedores/${proveedorA.id}`);
  await expect(page.getByRole("columnheader", { name: "Cómo lo llama" })).toBeVisible();
  await expect(page.getByRole("cell", { name: nombreEnLaFacturaA, exact: true })).toBeVisible();
  await capturar(page, "3-ficha-del-proveedor-a");
  await page.goto(`/catalogo/proveedores/${proveedorB.id}`);
  await expect(page.getByRole("cell", { name: nombreEnLaFacturaB, exact: true })).toBeVisible();
});
