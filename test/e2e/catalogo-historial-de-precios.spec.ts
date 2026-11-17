import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";
import { prisma } from "./fixtures/db";
import { prismaAdmin } from "../setup/cliente-duenio";
import { expectSinDesborde } from "./fixtures/movil";

/**
 * Paso 7 del plan de pantallas (dueño, 2026-11-17: «A»): el «Historial de precios» de la pestaña «Precios» de la ficha: fechas y precios de los CAMBIOS, sin el nombre de quien los hizo. A 375 y a 1280 px.
 */
const marca = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

for (const ancho of [1280, 375]) {
  test(`a ${ancho} px: la pestaña «Precios» lista los cambios con su fecha, sin el actor, y es accesible`, async ({ paginaAutenticada: page, sucursalId }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    const m = marca();
    const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
    const producto = await prisma.producto.create({ data: { codigo: `E2E-HP-${m}`, nombre: `E2E Historial ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 12000 } });
    await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
    const actor = await prismaAdmin.user.create({ data: { email: `actor-${m}@e2e.test`, name: `Nombre Secreto ${m}` } });
    const aud = (valorAnterior: string, valorNuevo: string, creadoEn: string) =>
      prismaAdmin.registroAuditoria.create({ data: { entidad: "Producto", entidadId: producto.id, campo: "precioVenta", descripcion: `Producto: precio de venta`, valorAnterior, valorNuevo, actorId: actor.id, creadoEn: new Date(creadoEn) } });
    await aud("10000", "11000", "2026-11-05T15:00:00Z");
    await aud("11000", "12000", "2026-11-12T15:00:00Z");
    try {
      await page.goto(`/catalogo/productos/${producto.id}/precios`);
      const historial = page.locator("[data-historial-de-precios]");
      await expect(historial.getByRole("heading", { name: "Historial de precios" })).toBeVisible();
      const lineas = historial.locator("[data-cambio-de-precio]");
      await expect(lineas).toHaveCount(2);
      await expect(lineas.nth(0)).toContainText("12/11/2026");
      await expect(lineas.nth(0)).toContainText("Precio de lista");
      await expect(lineas.nth(0)).toContainText("de $ 11.000,00 a $ 12.000,00");
      await expect(lineas.nth(1)).toContainText("05/11/2026");
      await expect(lineas.nth(1)).toContainText("de $ 10.000,00 a $ 11.000,00");
      // El actor no está en la pantalla (ni su email ni su nombre).
      await expect(page.locator("body")).not.toContainText(`actor-${m}@e2e.test`);
      await expect(page.locator("body")).not.toContainText(`Nombre Secreto ${m}`);
      if (ancho === 375) await expectSinDesborde(page, "pestaña Precios con el historial a 375 px");
      expect((await new AxeBuilder({ page }).analyze()).violations, "accesibilidad de la pestaña Precios").toEqual([]);
    } finally {
      await prismaAdmin.registroAuditoria.deleteMany({ where: { entidadId: producto.id } });
      await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
      await prisma.producto.delete({ where: { id: producto.id } });
      await prismaAdmin.user.delete({ where: { id: actor.id } });
    }
  });
}

test("sin cambios registrados: dice que todavía no hay (no inventa un precio de nacimiento)", async ({ paginaAutenticada: page, sucursalId }) => {
  const m = marca();
  const unidad = await prisma.unidad.findFirstOrThrow({ where: { nombre: "unidad" } });
  const producto = await prisma.producto.create({ data: { codigo: `E2E-HQ-${m}`, nombre: `E2E Sin historial ${m}`, tipo: "PV", unidadStockId: unidad.id, precioVenta: 5000 } });
  await prisma.disponibilidadProducto.create({ data: { sucursalId, productoId: producto.id, disponible: true } });
  try {
    await page.goto(`/catalogo/productos/${producto.id}/precios`);
    await expect(page.locator("[data-historial-de-precios]")).toContainText("Todavía no hay cambios de precio registrados.");
    await expect(page.locator("[data-cambio-de-precio]")).toHaveCount(0);
  } finally {
    await prisma.disponibilidadProducto.deleteMany({ where: { productoId: producto.id } });
    await prisma.producto.delete({ where: { id: producto.id } });
  }
});
