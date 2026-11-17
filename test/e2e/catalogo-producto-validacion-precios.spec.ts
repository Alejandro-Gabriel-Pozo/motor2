import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";

/**
 * Validación de datos en Catálogo > Producto (Task #31, docs/plan-validacion-de-datos-2026-09-25.md): precioVenta/
 * precioConsignacion/factorConversion pasan por el mismo parser central que Compra/Mesa/Mostrador (validarImporte/
 * validarCantidad vía CampoNumero), en vez de un `Number(x) > 0` a mano sin tope de decimales — mismo criterio que
 * test/e2e/movimientos-compra-wizard.spec.ts para el precio de una Compra. Antes, un precio con más decimales de los que
 * admite la columna, o un factor de conversión gigantesco, llegaban crudos al servidor y podían desbordar la columna
 * `Decimal` con un error de Postgres en vez de un mensaje entendible.
 */
/** Frente 2: el alta ya no pide precio; la validación del precio se prueba donde se pide hoy, la edición de un producto de venta (clave `producto_campos_sensibles`). */
async function sembrarProductoDeVenta(nombre: string) {
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  return prisma.producto.create({ data: { codigo: `E2E-PRECIO-${Date.now()}`, nombre, tipo: "PV", unidadStockId: kg.id, precioVenta: 100 } });
}

async function conProductoDeVenta(nombre: string, prueba: (id: string) => Promise<void>) {
  const producto = await sembrarProductoDeVenta(nombre);
  try {
    await prueba(producto.id);
  } finally {
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
}

test("un precio de venta con 3 decimales queda inválido en el campo y no se guarda", async ({ paginaAutenticada: page }) => {
  await conProductoDeVenta(`E2E Precio Inválido ${Date.now()}`, async (id) => {
    await page.goto(`/catalogo/productos/${id}/datos`);
    const precio = page.getByLabel("Precio de venta");
    await precio.fill("100,123");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    expect(await precio.evaluate((e: HTMLInputElement) => e.validity.customError), "el precio tiene que quedar inválido").toBe(true);
    expect(await precio.evaluate((e: HTMLInputElement) => e.validationMessage)).toMatch(/^El precio de venta admite como máximo 2 decimales\./);
    await page.waitForTimeout(500); // margen para que un envío que no debió salir llegue a la base
    expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id } })).precioVenta), "el precio no tenía que cambiar").toBe(100);
  });
});

test("un precio de venta negativo queda inválido en el campo", async ({ paginaAutenticada: page }) => {
  await conProductoDeVenta(`E2E Precio Negativo ${Date.now()}`, async (id) => {
    await page.goto(`/catalogo/productos/${id}/datos`);
    const precio = page.getByLabel("Precio de venta");
    await precio.fill("-100");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    expect(await precio.evaluate((e: HTMLInputElement) => e.validity.customError)).toBe(true);
    expect(await precio.evaluate((e: HTMLInputElement) => e.validationMessage)).toBe("El precio de venta no puede ser negativo.");
  });
});

/** El alta como Pedernal ya no pide el factor de conversión (decisión del dueño, 2026-11-17); la validación se prueba donde se pide hoy, la edición de una materia prima (clave `producto_campos_sensibles`). */
test("un factor de conversión con más decimales de los que admite la unidad de stock (kg admite 2) queda inválido", async ({ paginaAutenticada: page }) => {
  const kg = await prisma.unidad.findFirstOrThrow({ where: { nombre: "kg" } });
  const nombreProducto = `E2E Factor Inválido ${Date.now()}`;
  const producto = await prisma.producto.create({ data: { codigo: `E2E-FACTOR-${Date.now()}`, nombre: nombreProducto, tipo: "MP", unidadStockId: kg.id } });
  try {
    await page.goto(`/catalogo/productos/${producto.id}/datos`);
    const factor = page.getByLabel("Factor de conversión (unidades de stock por unidad de compra)");
    await factor.fill("1,234");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    expect(await factor.evaluate((e: HTMLInputElement) => e.validity.customError), "el factor de conversión tiene que quedar inválido").toBe(true);
    expect(await factor.evaluate((e: HTMLInputElement) => e.validationMessage)).toMatch(/admite como máximo 2 decimales/);
    await page.waitForTimeout(500);
    expect(Number((await prisma.producto.findUniqueOrThrow({ where: { id: producto.id } })).factorConversion), "el factor no tenía que cambiar").toBe(1);
  } finally {
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.deleteMany({ where: { id: producto.id } });
  }
});
